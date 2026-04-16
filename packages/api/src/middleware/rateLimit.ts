import type { MiddlewareHandler } from 'hono';
import { fail } from '../lib/response';

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

/** Extracts the best-effort client IP from common proxy headers. */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  return 'unknown';
}
