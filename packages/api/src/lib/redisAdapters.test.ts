import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import RedisMock from 'ioredis-mock';
import {
  createRedisNonceCache,
  type RedisSetNxClient,
} from './identityToken';
import {
  createRedisRateLimiter,
  type RedisEvalClient,
} from '../middleware/rateLimit';

type MockClient = InstanceType<typeof RedisMock>;
const asSetNx = (r: MockClient) => r as unknown as RedisSetNxClient;
const asEval = (r: MockClient) => r as unknown as RedisEvalClient;

describe('createRedisNonceCache', () => {
  it('first call sees the nonce unseen, second sees it as replay', async () => {
    const redis = new RedisMock();
    const cache = createRedisNonceCache(asSetNx(redis));

    assert.equal(await cache.hasSeen('v1:abc'), false);
    assert.equal(await cache.hasSeen('v1:abc'), true);
    assert.equal(await cache.hasSeen('v1:def'), false);
  });

  it('respects a custom prefix so co-tenant data stays separate', async () => {
    const redis = new RedisMock();
    const a = createRedisNonceCache(asSetNx(redis), { prefix: 'app1:' });
    const b = createRedisNonceCache(asSetNx(redis), { prefix: 'app2:' });

    assert.equal(await a.hasSeen('shared'), false);
    assert.equal(await b.hasSeen('shared'), false);
  });

  it('returns false after TTL elapses', async () => {
    const redis = new RedisMock();
    const cache = createRedisNonceCache(asSetNx(redis), { ttlSeconds: 1 });
    assert.equal(await cache.hasSeen('expiring'), false);
    assert.equal(await cache.hasSeen('expiring'), true);

    await redis.del('koe:nonce:expiring');
    assert.equal(await cache.hasSeen('expiring'), false);
  });

  afterAll();
});

describe('createRedisRateLimiter', () => {
  it('allows up to capacity then denies with a retry-after', async () => {
    const redis = new RedisMock();
    const limiter = createRedisRateLimiter(asEval(redis), {
      refillPerSecond: 1,
      capacity: 3,
    });

    const a = await limiter.consume('client-1');
    const b = await limiter.consume('client-1');
    const c = await limiter.consume('client-1');
    const d = await limiter.consume('client-1');

    assert.equal(a.allowed, true);
    assert.equal(b.allowed, true);
    assert.equal(c.allowed, true);
    assert.equal(d.allowed, false);
    if (!d.allowed) {
      assert.ok(d.retryAfter >= 1 && d.retryAfter <= 2);
    }
  });

  it('isolates keys — client-2 does not pay for client-1s burst', async () => {
    const redis = new RedisMock();
    const limiter = createRedisRateLimiter(asEval(redis), {
      refillPerSecond: 1,
      capacity: 2,
    });

    await limiter.consume('client-1');
    await limiter.consume('client-1');
    const exhausted = await limiter.consume('client-1');
    const fresh = await limiter.consume('client-2');

    assert.equal(exhausted.allowed, false);
    assert.equal(fresh.allowed, true);
  });

  it('applies the prefix so buckets do not collide across routes', async () => {
    const redis = new RedisMock();
    const widget = createRedisRateLimiter(asEval(redis), {
      refillPerSecond: 1,
      capacity: 1,
      prefix: 'koe:rl:widget:',
    });
    const admin = createRedisRateLimiter(asEval(redis), {
      refillPerSecond: 1,
      capacity: 1,
      prefix: 'koe:rl:admin:',
    });

    assert.equal((await widget.consume('ip-1')).allowed, true);
    assert.equal((await widget.consume('ip-1')).allowed, false);
    assert.equal((await admin.consume('ip-1')).allowed, true);
  });

  afterAll();
});

function afterAll() {
}
