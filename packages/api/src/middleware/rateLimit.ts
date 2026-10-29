import type { Context, MiddlewareHandler } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { fail } from '../lib/response';
import { getRedisFromEnv } from '../lib/redis';

export interface RateLimiterConfig {
  refillPerSecond: number;
  capacity: number;
}

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfter: number };

export interface RateLimiter {
  consume(key: string, cost?: number): Promise<RateLimitDecision>;
}

interface Bucket {
  tokens: number;
  lastRefill: number;
}

export function createInMemoryRateLimiter(config: RateLimiterConfig): RateLimiter {
  const buckets = new Map<string, Bucket>();

  return {
    async consume(key, cost = 1) {
      const now = Date.now();
      let bucket = buckets.get(key);

      if (!bucket) {
        bucket = { tokens: config.capacity, lastRefill: now };
        buckets.set(key, bucket);
      } else {
        const elapsedSec = (now - bucket.lastRefill) / 1000;
        bucket.tokens = Math.min(
          config.capacity,
          bucket.tokens + elapsedSec * config.refillPerSecond,
        );
        bucket.lastRefill = now;
      }

      if (bucket.tokens < cost) {
        const retryAfter = Math.ceil((cost - bucket.tokens) / config.refillPerSecond);
        return { allowed: false, retryAfter };
      }

      bucket.tokens -= cost;
      return { allowed: true };
    },
  };
}

export interface RedisEvalClient {
  eval(
    script: string,
    numkeys: number,
    ...args: Array<string | number>
  ): Promise<unknown>;
}

export interface RedisRateLimiterOptions extends RateLimiterConfig {
  prefix?: string;
}

const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local cost = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local capacity = tonumber(ARGV[3])
local now = tonumber(ARGV[4])

local data = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens = tonumber(data[1])
local lastRefill = tonumber(data[2])
if tokens == nil then
  tokens = capacity
  lastRefill = now
end

local elapsedSec = (now - lastRefill) / 1000
tokens = math.min(capacity, tokens + elapsedSec * refill)

local allowed = 0
local retryAfter = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  retryAfter = math.ceil((cost - tokens) / refill)
end

redis.call('HSET', key, 'tokens', tokens, 'last_refill', now)
-- Key evicts if the app dies. Enough for the bucket to fully refill.
redis.call('PEXPIRE', key, math.ceil((capacity / refill) * 1000) + 1000)

return {allowed, retryAfter}
`;

export function createRedisRateLimiter(
  client: RedisEvalClient,
  opts: RedisRateLimiterOptions,
): RateLimiter {
  const prefix = opts.prefix ?? 'koe:rl:';

  return {
    async consume(key, cost = 1) {
      const result = (await client.eval(
        TOKEN_BUCKET_LUA,
        1,
        `${prefix}${key}`,
        cost,
        opts.refillPerSecond,
        opts.capacity,
        Date.now(),
      )) as [number, number];

      const [allowed, retryAfter] = result;
      if (allowed === 1) return { allowed: true };
      return { allowed: false, retryAfter };
    },
  };
}

export interface RateLimitOptions extends RateLimiterConfig {
  key: (c: Parameters<MiddlewareHandler>[0]) => string;
  limiter?: RateLimiter;
}

export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
  const limiter = opts.limiter ?? createInMemoryRateLimiter(opts);

  return async (c, next) => {
    const key = opts.key(c);
    if (key.includes(UNKNOWN_IP_SENTINEL)) {
      if (IS_PRODUCTION) {
        console.error(
          '[koe/api] rate-limit key resolved to unknown IP — failing closed in production',
        );
        return fail(c, 'internal_error', 'Unable to identify client', 500);
      }
      console.warn(
        '[koe/api] rate-limit key resolved to unknown IP — admitting in dev (set TRUST_PROXY_HEADERS=true behind a proxy in prod)',
      );
    }
    const decision = await limiter.consume(key);
    if (!decision.allowed) {
      c.header('Retry-After', String(decision.retryAfter));
      return fail(c, 'rate_limited', 'Too many requests', 429);
    }
    await next();
  };
}

export function createRateLimiterFromEnv(config: RateLimiterConfig & { prefix?: string }): RateLimiter {
  const redis = getRedisFromEnv();
  if (redis) {
    return createRedisRateLimiter(redis as unknown as RedisEvalClient, config);
  }
  return createInMemoryRateLimiter(config);
}

const PROXY_HEADERS_TRUSTED =
  (process.env.TRUST_PROXY_HEADERS ?? 'false').toLowerCase() === 'true';

const IS_PRODUCTION = (process.env.NODE_ENV ?? '').toLowerCase() === 'production';

export const UNKNOWN_IP_SENTINEL = 'unknown';

export function clientIp(c: Context): string {
  if (PROXY_HEADERS_TRUSTED) {
    const forwarded = c.req.header('x-forwarded-for');
    if (forwarded) return forwarded.split(',')[0]!.trim();
    const real = c.req.header('x-real-ip');
    if (real) return real.trim();
  }
  try {
    const info = getConnInfo(c);
    const remote = info.remote?.address;
    if (remote) return remote;
  } catch {
  }
  return UNKNOWN_IP_SENTINEL;
}
