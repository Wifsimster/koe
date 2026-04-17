import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  createLocalKekSecretStore,
  createPlaintextSecretStore,
  ENVELOPE_PREFIX,
  isEnvelope,
  readEnvelopeKid,
} from './secretStore';

const PLAINTEXT = 'super-secret-hmac-key-0123456789';

function key(): Buffer {
  return randomBytes(32);
}

describe('secretStore local-kek', () => {
  it('round-trips a secret via the active kid', () => {
    const store = createLocalKekSecretStore({
      keys: new Map([['v1', key()]]),
      activeKid: 'v1',
    });
    const blob = store.encrypt(PLAINTEXT);
    assert.ok(blob.startsWith(`${ENVELOPE_PREFIX}.v1.`));
    assert.equal(store.decrypt(blob), PLAINTEXT);
  });

  it('produces different ciphertexts for the same plaintext (nonce is fresh)', () => {
    const store = createLocalKekSecretStore({
      keys: new Map([['v1', key()]]),
      activeKid: 'v1',
    });
    const a = store.encrypt(PLAINTEXT);
    const b = store.encrypt(PLAINTEXT);
    assert.notEqual(a, b);
  });

  it('decrypts blobs written under a retired kid when the key is still loaded', () => {
    const k1 = key();
    const k2 = key();
    const oldStore = createLocalKekSecretStore({
      keys: new Map([['v1', k1]]),
      activeKid: 'v1',
    });
    const blob = oldStore.encrypt(PLAINTEXT);

    // Now we've rotated: v2 is active, but v1 is still available for
    // decrypting old blobs during the re-encryption window.
    const newStore = createLocalKekSecretStore({
      keys: new Map([
        ['v1', k1],
        ['v2', k2],
      ]),
      activeKid: 'v2',
    });
    assert.equal(newStore.decrypt(blob), PLAINTEXT);

    // New encrypts use the active kid.
    const fresh = newStore.encrypt(PLAINTEXT);
    assert.ok(fresh.startsWith(`${ENVELOPE_PREFIX}.v2.`));
  });

  it('throws on an unknown kid', () => {
    const store = createLocalKekSecretStore({
      keys: new Map([['v2', key()]]),
      activeKid: 'v2',
    });
    const spoofed = `${ENVELOPE_PREFIX}.v1.aaaa.bbbb.cccc`;
    assert.throws(() => store.decrypt(spoofed), /Unknown secret kid/);
  });

  it('throws on a tampered tag', () => {
    const store = createLocalKekSecretStore({
      keys: new Map([['v1', key()]]),
      activeKid: 'v1',
    });
    const blob = store.encrypt(PLAINTEXT);
    const parts = blob.split('.');
    // Flip a character in the auth tag.
    parts[4] = parts[4]!.replace(/^./, (c) => (c === 'a' ? 'b' : 'a'));
    const tampered = parts.join('.');
    assert.throws(() => store.decrypt(tampered));
  });

  it('throws on a tampered ciphertext', () => {
    const store = createLocalKekSecretStore({
      keys: new Map([['v1', key()]]),
      activeKid: 'v1',
    });
    const blob = store.encrypt(PLAINTEXT);
    const parts = blob.split('.');
    parts[3] = parts[3]!.replace(/^./, (c) => (c === 'a' ? 'b' : 'a'));
    const tampered = parts.join('.');
    assert.throws(() => store.decrypt(tampered));
  });

  it('passes legacy plaintext through unchanged', () => {
    const store = createLocalKekSecretStore({
      keys: new Map([['v1', key()]]),
      activeKid: 'v1',
    });
    assert.equal(store.decrypt('not-an-envelope'), 'not-an-envelope');
    assert.equal(store.decrypt('cafebabe'), 'cafebabe');
  });

  it('rejects keys of wrong length at construction', () => {
    assert.throws(
      () =>
        createLocalKekSecretStore({
          keys: new Map([['v1', randomBytes(16)]]),
          activeKid: 'v1',
        }),
      /must be 32 bytes/,
    );
  });

  it('rejects an activeKid that is not in the key set', () => {
    assert.throws(
      () =>
        createLocalKekSecretStore({
          keys: new Map([['v1', key()]]),
          activeKid: 'v999',
        }),
      /not present/,
    );
  });

  it('rejects malformed envelopes', () => {
    const store = createLocalKekSecretStore({
      keys: new Map([['v1', key()]]),
      activeKid: 'v1',
    });
    assert.throws(() => store.decrypt(`${ENVELOPE_PREFIX}.v1.xx.yy`), /Malformed/);
  });
});

describe('secretStore plaintext', () => {
  it('round-trips a secret unchanged', () => {
    const store = createPlaintextSecretStore(false);
    assert.equal(store.encrypt(PLAINTEXT), PLAINTEXT);
    assert.equal(store.decrypt(PLAINTEXT), PLAINTEXT);
  });
});

describe('isEnvelope', () => {
  it('detects the envelope prefix', () => {
    assert.equal(isEnvelope(`${ENVELOPE_PREFIX}.v1.a.b.c`), true);
    assert.equal(isEnvelope('koe2.v1.a.b.c'), false);
    assert.equal(isEnvelope('plaintext'), false);
    assert.equal(isEnvelope(''), false);
  });
});

describe('readEnvelopeKid', () => {
  it('extracts the kid from a well-formed envelope', () => {
    const store = createLocalKekSecretStore({
      keys: new Map([['v42', key()]]),
      activeKid: 'v42',
    });
    const blob = store.encrypt('hello');
    assert.equal(readEnvelopeKid(blob), 'v42');
  });

  it('returns null for plaintext', () => {
    assert.equal(readEnvelopeKid('plaintext-value'), null);
    assert.equal(readEnvelopeKid(''), null);
  });

  it('returns null for a malformed envelope', () => {
    assert.equal(readEnvelopeKid(`${ENVELOPE_PREFIX}.v1.xx.yy`), null);
    assert.equal(readEnvelopeKid(`${ENVELOPE_PREFIX}..a.b.c`), null);
  });
});
