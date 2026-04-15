import type { MiddlewareHandler } from 'hono';
import { fail } from '../lib/response';

interface Bucket {
  tokens: number;
  lastRefill: number;
}

export interface RateLimitOptions {
  /** Tokens added per second. */
  refillPerSecond: number;
  /** Maximum burst size. */
  capacity: number;
  /** Extract the key to bucket on. Called per request. */
  key: (c: Parameters<MiddlewareHandler>[0]) => string;
}

/**
 * Simple in-memory token bucket. Good enough for a single-instance dev
 * deployment; swap for Redis or Durable Objects before running multiple
 * API replicas. Per-key state never expires — that's fine because the
 * key is always bounded (project_id + ip) but you should set up a
 * periodic sweep if this runs for months at a time.
 */
export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
  const buckets = new Map<string, Bucket>();

  return async (c, next) => {
    const now = Date.now();
    const id = opts.key(c);
    let bucket = buckets.get(id);

    if (!bucket) {
      bucket = { tokens: opts.capacity, lastRefill: now };
      buckets.set(id, bucket);
    } else {
      const elapsedSec = (now - bucket.lastRefill) / 1000;
      bucket.tokens = Math.min(opts.capacity, bucket.tokens + elapsedSec * opts.refillPerSecond);
      bucket.lastRefill = now;
    }

    if (bucket.tokens < 1) {
      const retryAfter = Math.ceil((1 - bucket.tokens) / opts.refillPerSecond);
      c.header('Retry-After', String(retryAfter));
      return fail(c, 'rate_limited', 'Too many requests', 429);
    }

    bucket.tokens -= 1;
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
