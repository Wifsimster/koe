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

  it('rejects an unknown kid', async () => {
    const secrets = makeSecrets([{ kid: 'v1', secret: secretV1 }]);
    const token = signIdentityToken(makePayload({ kid: 'v99' }), secretV1);

    const result = await verifyIdentityToken(token, secrets, baseOpts(createInMemoryNonceCache()));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'unknown_kid');
  });

  it('rejects a revoked kid even with a valid signature', async () => {
    const secrets = makeSecrets([{ kid: 'v1', secret: secretV1, status: 'revoked' }]);
    const token = signIdentityToken(makePayload(), secretV1);

    const result = await verifyIdentityToken(token, secrets, baseOpts(createInMemoryNonceCache()));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'revoked_kid');
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
});
