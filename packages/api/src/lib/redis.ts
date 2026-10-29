import Redis, { type Redis as RedisClient, type RedisOptions } from 'ioredis';

let cached: RedisClient | null | undefined;

export function getRedisFromEnv(): RedisClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.REDIS_URL?.trim();
  if (!url) {
    cached = null;
    return null;
  }

  const opts: RedisOptions = {
    maxRetriesPerRequest: 3,
  };

  cached = new Redis(url, opts);
  cached.on('error', (err) => {
    console.warn('[koe/api] redis error', err.message);
  });
  return cached;
}

export async function closeRedis(): Promise<void> {
  const client = cached;
  cached = undefined;
  if (!client) return;
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
}

export function __setRedisForTest(client: RedisClient | null): void {
  cached = client;
}
