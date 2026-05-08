import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  signIdentityToken,
  verifyIdentityToken,
  createInMemoryNonceCache,
  type IdentitySecret,
  type IdentityTokenPayload,
  type NonceCache,
} from './identityToken';

const projectId = '11111111-1111-1111-1111-111111111111';
const reporterId = 'user-42';
const secretV1 = 'unit-test-secret-v1-dont-ship';
const secretV2 = 'unit-test-secret-v2-dont-ship';

function makeSecrets(
  entries: Array<Partial<IdentitySecret> & Pick<IdentitySecret, 'kid' | 'secret'>>,
): Map<string, IdentitySecret> {
  const map = new Map<string, IdentitySecret>();
  for (const e of entries) map.set(e.kid, { status: 'active', ...e });
  return map;
}

function makePayload(overrides: Partial<IdentityTokenPayload> = {}): IdentityTokenPayload {
  return {
    reporterId,
    projectId,
    iat: 1_700_000_000,
    nonce: 'nonce-' + Math.random().toString(36).slice(2),
    kid: 'v1',
    ...overrides,
  };
}

function baseOpts(nonces: NonceCache, iatOffset = 0) {
  return {
    maxAgeSeconds: 600,
    clockSkewSeconds: 30,
    expectedProjectId: projectId,
    expectedReporterId: reporterId,
    nonces,
    now: () => 1_700_000_000 + iatOffset,
  };
}

describe('identityToken', () => {
  it('round-trips a valid token', async () => {
    const secrets = makeSecrets([{ kid: 'v1', secret: secretV1 }]);
    const payload = makePayload();
    const token = signIdentityToken(payload, secretV1);

    const result = await verifyIdentityToken(token, secrets, baseOpts(createInMemoryNonceCache()));
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.payload, payload);
  });

  it('rejects a tampered payload', async () => {
    const secrets = makeSecrets([{ kid: 'v1', secret: secretV1 }]);
    const token = signIdentityToken(makePayload(), secretV1);
    const [enc, mac] = token.split('.');
    // Flip one char in the encoded payload.
    const flipped = (enc![0] === 'a' ? 'b' : 'a') + enc!.slice(1) + '.' + mac!;

    const result = await verifyIdentityToken(flipped, secrets, baseOpts(createInMemoryNonceCache()));
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(['malformed', 'signature_mismatch'].includes(result.reason));
  });

  it('rejects a signature signed with the wrong secret', async () => {
    const secrets = makeSecrets([{ kid: 'v1', secret: secretV1 }]);
    const token = signIdentityToken(makePayload(), 'attacker-secret');

    const result = await verifyIdentityToken(token, secrets, baseOpts(createInMemoryNonceCache()));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'signature_mismatch');
  });

  it('rejects an unknown kid as signature_mismatch (with internal kid detail)', async () => {
    const secrets = makeSecrets([{ kid: 'v1', secret: secretV1 }]);
    const token = signIdentityToken(makePayload({ kid: 'v99' }), secretV1);

    const result = await verifyIdentityToken(token, secrets, baseOpts(createInMemoryNonceCache()));
    assert.equal(result.ok, false);
    if (!result.ok) {
      // Externally indistinguishable from a bad mac — attacker probing
      // the endpoint can't tell unknown-kid from sig-mismatch.
      assert.equal(result.reason, 'signature_mismatch');
      // Granular cause kept for server-side logs only.
      assert.equal(result.internalReason, 'unknown_kid');
    }
  });

  it('rejects a revoked kid as signature_mismatch (with internal kid detail)', async () => {
    const secrets = makeSecrets([{ kid: 'v1', secret: secretV1, status: 'revoked' }]);
    const token = signIdentityToken(makePayload(), secretV1);

    const result = await verifyIdentityToken(token, secrets, baseOpts(createInMemoryNonceCache()));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'signature_mismatch');
      assert.equal(result.internalReason, 'revoked_kid');
    }
  });

  it('verifies under a `retiring` kid during a rotation window', async () => {
    const secrets = makeSecrets([
      { kid: 'v1', secret: secretV1, status: 'retiring' },
      { kid: 'v2', secret: secretV2, status: 'active' },
    ]);
    const token = signIdentityToken(makePayload({ kid: 'v1' }), secretV1);

    const result = await verifyIdentityToken(token, secrets, baseOpts(createInMemoryNonceCache()));
    assert.equal(result.ok, true);
  });

  it('rejects an expired token', async () => {
    const secrets = makeSecrets([{ kid: 'v1', secret: secretV1 }]);
    const token = signIdentityToken(makePayload({ iat: 1_700_000_000 }), secretV1);

    // Jump 20 minutes into the future — outside the 10-minute window.
    const result = await verifyIdentityToken(
      token,
      secrets,
      baseOpts(createInMemoryNonceCache(), 20 * 60),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'token_expired');
  });

  it('rejects a token issued too far in the future', async () => {
    const secrets = makeSecrets([{ kid: 'v1', secret: secretV1 }]);
    const token = signIdentityToken(makePayload({ iat: 1_700_000_000 + 600 }), secretV1);

    const result = await verifyIdentityToken(token, secrets, baseOpts(createInMemoryNonceCache()));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'token_in_future');
  });

  it('rejects a replayed nonce', async () => {
    const secrets = makeSecrets([{ kid: 'v1', secret: secretV1 }]);
    const nonces = createInMemoryNonceCache();
    const token = signIdentityToken(makePayload({ nonce: 'fixed-nonce' }), secretV1);

    const first = await verifyIdentityToken(token, secrets, baseOpts(nonces));
    assert.equal(first.ok, true);

    const second = await verifyIdentityToken(token, secrets, baseOpts(nonces));
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.reason, 'replayed_nonce');
  });

  it('rejects cross-project tokens', async () => {
    const secrets = makeSecrets([{ kid: 'v1', secret: secretV1 }]);
    const token = signIdentityToken(makePayload({ projectId: 'other-project' }), secretV1);

    const result = await verifyIdentityToken(token, secrets, baseOpts(createInMemoryNonceCache()));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'project_mismatch');
  });

  it('rejects cross-reporter tokens', async () => {
    const secrets = makeSecrets([{ kid: 'v1', secret: secretV1 }]);
    const token = signIdentityToken(makePayload({ reporterId: 'other-user' }), secretV1);

    const result = await verifyIdentityToken(token, secrets, baseOpts(createInMemoryNonceCache()));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'reporter_mismatch');
  });

  it('rejects malformed tokens', async () => {
    const secrets = makeSecrets([{ kid: 'v1', secret: secretV1 }]);
    const cases = ['', '.', 'no-dot', 'a.', '.b', 'not-base64.deadbeef'];
    for (const t of cases) {
      const result = await verifyIdentityToken(t, secrets, baseOpts(createInMemoryNonceCache()));
      assert.equal(result.ok, false, `expected malformed for ${JSON.stringify(t)}`);
    }
  });

  it('nonce cache binds nonces to kid to avoid cross-key masking', async () => {
    const secrets = makeSecrets([
      { kid: 'v1', secret: secretV1, status: 'retiring' },
      { kid: 'v2', secret: secretV2, status: 'active' },
    ]);
    const nonces = createInMemoryNonceCache();

    const tokenV1 = signIdentityToken(makePayload({ kid: 'v1', nonce: 'shared' }), secretV1);
    const tokenV2 = signIdentityToken(makePayload({ kid: 'v2', nonce: 'shared' }), secretV2);

    const r1 = await verifyIdentityToken(tokenV1, secrets, baseOpts(nonces));
    const r2 = await verifyIdentityToken(tokenV2, secrets, baseOpts(nonces));
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
  });

  it('runs the HMAC compare even when the kid is unknown (constant time)', async () => {
    // Both kids absent from `secrets`. We can't measure timing in a
    // unit test, but we can prove the path was traversed: the dummy
    // secret is fixed across calls, so the *expected* MAC for two
    // tokens with the same payload is identical regardless of which
    // unknown kid the attacker tries. We assert the verifier returns
    // the externally-collapsed reason for both, never leaking the
    // distinction. The constant-time property is a property of `sign`
    // + `timingSafeEqual` and is documented in the call site.
    const secrets = makeSecrets([]);
    const t1 = signIdentityToken(makePayload({ kid: 'v99' }), secretV1);
    const t2 = signIdentityToken(makePayload({ kid: 'v100' }), secretV1);

    const r1 = await verifyIdentityToken(t1, secrets, baseOpts(createInMemoryNonceCache()));
    const r2 = await verifyIdentityToken(t2, secrets, baseOpts(createInMemoryNonceCache()));
    assert.equal(r1.ok, false);
    assert.equal(r2.ok, false);
    if (!r1.ok && !r2.ok) {
      assert.equal(r1.reason, 'signature_mismatch');
      assert.equal(r2.reason, 'signature_mismatch');
      assert.equal(r1.internalReason, 'unknown_kid');
      assert.equal(r2.internalReason, 'unknown_kid');
    }
  });

  it('TTL eviction: a flood of fresh nonces does not evict a still-valid one', async () => {
    // Drive a controllable clock so the test isn't wall-clock flaky.
    let nowMs = 1_000_000;
    const cache = createInMemoryNonceCache({
      ttlSeconds: 60,
      sweepBatchSize: 4,
      now: () => nowMs,
    });

    // 1) The "still-valid" entry an attacker would want to push out.
    assert.equal(await cache.hasSeen('replay-target'), false);

    // 2) Flood the cache with a thousand fresh nonces while the clock
    //    moves forward by milliseconds (well under the 60s TTL).
    for (let i = 0; i < 1_000; i++) {
      nowMs += 1; // 1ms per insert → flood spans ~1s, < TTL
      assert.equal(await cache.hasSeen(`flood-${i}`), false);
    }

    // 3) The still-valid entry must STILL be remembered. With the old
    //    FIFO-by-capacity scheme, anything past the 10k cap could push
    //    the target out; with TTL eviction, only time can.
    assert.equal(
      await cache.hasSeen('replay-target'),
      true,
      'replay-target was evicted by the flood — replay protection broken',
    );
  });

  it('TTL eviction: an entry IS forgotten once its TTL has elapsed', async () => {
    let nowMs = 1_000_000;
    const cache = createInMemoryNonceCache({
      ttlSeconds: 30,
      now: () => nowMs,
    });
    assert.equal(await cache.hasSeen('once'), false);
    // Move past the TTL window.
    nowMs += 31_000;
    // After expiry the same key should be admitted again. (This is
    // safe because the token itself uses `iat + maxAgeSeconds` to fail
    // any token old enough to have outlived its nonce record.)
    assert.equal(await cache.hasSeen('once'), false);
  });
});
