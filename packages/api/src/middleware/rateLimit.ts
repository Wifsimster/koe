import type { MiddlewareHandler } from 'hono';
import { fail } from '../lib/response';
import { getRedisFromEnv } from '../lib/redis';

export interface RateLimiterConfig {
  /** Tokens added per second. */
  refillPerSecond: number;
  /** Maximum burst size. */
  capacity: number;
}

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfter: number };

/**
 * Pluggable rate limiter port. The widget CORS path uses the in-memory
 * adapter today; the infra MR swaps in a Redis adapter (sliding window,
 * keyed on projectId+ip+reporterId) without touching middleware call
 * sites. `consume` is async so adapters that make network calls fit
 * without refactoring.
 */
export interface RateLimiter {
  consume(key: string, cost?: number): Promise<RateLimitDecision>;
}

interface Bucket {
  tokens: number;
  lastRefill: number;
}

/**
 * In-memory token bucket. State never expires — that's fine because keys
 * are bounded (project_id + ip). Per-replica only; the moment we add a
 * second API pod, swap for Redis in the infra MR.
 */
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

/**
 * Minimal shape of the Redis client the Redis rate limiter needs.
 * Declared here so this module stays importable in environments where
 * `ioredis` isn't installed — the Redis adapter factory is the only
 * call site that actually reaches for the real client.
 */
export interface RedisEvalClient {
  eval(
    script: string,
    numkeys: number,
    ...args: Array<string | number>
  ): Promise<unknown>;
}

export interface RedisRateLimiterOptions extends RateLimiterConfig {
  /** Key prefix so we can share the Redis DB with other data. */
  prefix?: string;
}

/*
 * Token-bucket Lua script. Runs atomically — a single EVAL call
 * does the read, the refill math, the decrement, and the TTL renew
 * without a round-trip for each. Replicas racing on the same key
 * observe a consistent bucket.
 *
 * Arguments (ARGV):
 *   1 = cost (tokens to consume)
 *   2 = refillPerSecond
 *   3 = capacity
 *   4 = nowMs (server clock; we use the caller's so Redis TIME drift doesn't surprise anyone)
 *
 * Return: [allowed(0|1), retryAfterSeconds]
 */
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

/**
 * Redis-backed rate limiter. Token bucket, atomic via a Lua script —
 * the shape is identical to the in-memory adapter so the middleware
 * call site is unchanged. A single bucket is shared across all
 * replicas that point at the same Redis instance, which is the whole
 * reason this exists.
 */
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
  /** Extract the key to bucket on. Called per request. */
  key: (c: Parameters<MiddlewareHandler>[0]) => string;
  /**
   * Override the limiter implementation. Defaults to a fresh in-memory
   * limiter seeded with `refillPerSecond`/`capacity`. Provide a shared
   * instance (or a Redis-backed adapter) to let multiple routes share
   * buckets or survive process restarts.
   */
  limiter?: RateLimiter;
}

/**
 * Rate-limit middleware. Preserves the original call shape so existing
 * routes don't need to change; the underlying limiter is now
 * swappable via `opts.limiter`.
 */
export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
  const limiter = opts.limiter ?? createInMemoryRateLimiter(opts);

  return async (c, next) => {
    const decision = await limiter.consume(opts.key(c));
    if (!decision.allowed) {
      c.header('Retry-After', String(decision.retryAfter));
      return fail(c, 'rate_limited', 'Too many requests', 429);
    }
    await next();
  };
}

/**
 * Picks the right limiter based on whether Redis is configured. Use
 * this at the middleware mount site so both deployment modes — single
 * replica / in-memory, multi-replica / Redis — go through the same
 * call shape. Memoising per-config isn't worth it: limiter setup is
 * constant-time, and sharing a single limiter across unrelated routes
 * would mix their buckets.
 */
export function createRateLimiterFromEnv(config: RateLimiterConfig & { prefix?: string }): RateLimiter {
  const redis = getRedisFromEnv();
  if (redis) {
    // `ioredis`'s `eval` signature is overloaded; our narrow
    // `RedisEvalClient` interface covers the single overload we need.
    // Cast at the seam, not at every call site.
    return createRedisRateLimiter(redis as unknown as RedisEvalClient, config);
  }
  return createInMemoryRateLimiter(config);
}

/** Extracts the best-effort client IP from common proxy headers. */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  return 'unknown';
}
