import Redis, { type Redis as RedisClient, type RedisOptions } from 'ioredis';

/**
 * Lazy Redis connection. Constructed on first call when `REDIS_URL`
 * is set; returns `null` otherwise. Callers fall back to in-memory
 * adapters when this returns null — a deploy without Redis still
 * works, just not across multiple replicas.
 *
 * `ioredis` handles reconnect-on-disconnect and command queueing
 * during transient blips, so the single global instance is safe to
 * share across the whole process.
 */

let cached: RedisClient | null | undefined;

export function getRedisFromEnv(): RedisClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.REDIS_URL?.trim();
  if (!url) {
    cached = null;
    return null;
  }

  const opts: RedisOptions = {
    // `lazyConnect: false` (default) means we open the socket
    // eagerly. That's what we want — a misconfigured URL should fail
    // loud on boot, not on the first widget request.
    // `maxRetriesPerRequest: 3` bounds how long a single command
    // waits during a disconnect. Past that we fail the request rather
    // than hang the widget.
    maxRetriesPerRequest: 3,
  };

  cached = new Redis(url, opts);
  cached.on('error', (err) => {
    // Don't crash the process — the adapter code handles connection
    // failures per-command and the in-memory fallback path in
    // `rateLimit` / `identity` degrades gracefully.
    console.warn('[koe/api] redis error', err.message);
  });
  return cached;
}

/** Test-only hook to swap or reset the cached client. */
export function __setRedisForTest(client: RedisClient | null): void {
  cached = client;
}
