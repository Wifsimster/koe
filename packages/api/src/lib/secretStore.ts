import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Secret-at-rest encryption for things the DB should never carry in
 * plaintext — HMAC secrets for identity verification today, anything
 * equivalent tomorrow.
 *
 * Envelope shape, serialized as one dotted string:
 *
 *     koe1.<kid>.<nonceB64Url>.<ciphertextB64Url>.<tagB64Url>
 *
 * - Prefix `koe1` pins the format so we can evolve it without breaking
 *   the detector.
 * - `kid` selects which master key unwrapped the secret. Rotation
 *   works by adding a new kid, re-encrypting blobs with it, and
 *   retiring the old one — the DB can hold mixed kids during the
 *   window.
 * - AES-256-GCM. The 12-byte nonce is fresh per encrypt; authentication
 *   tag is 16 bytes, catches any ciphertext tampering on decrypt.
 *
 * Any blob that does NOT start with `koe1.` is treated as legacy
 * plaintext — decrypt returns it as-is. That's how we roll out without
 * a flag-day migration: new rows are encrypted, old rows stay readable
 * until an operator runs the future `rotate-secrets` CLI.
 */

export interface SecretStore {
  /** Returns an encrypted envelope for the given plaintext. */
  encrypt(plaintext: string): string;
  /**
   * Decrypts an envelope; if `value` doesn't look like a v1 envelope,
   * returns it unchanged (legacy plaintext path). Throws on malformed
   * envelopes or authentication failure.
   */
  decrypt(value: string): string;
}

export const ENVELOPE_PREFIX = 'koe1';
const ALGO = 'aes-256-gcm';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export interface LocalKekOptions {
  /** kid → 32-byte key. At least one entry required. */
  keys: Map<string, Buffer>;
  /** kid used for new encryptions. Must be a key in `keys`. */
  activeKid: string;
}

/**
 * Local-KEK adapter: the master keys live in this process's
 * configuration (today, env vars). Good enough for self-hosted
 * deployments that don't yet have cloud KMS; the blob format is the
 * same one a future AWS/GCP KMS adapter emits, so migrating is a
 * re-encrypt, not a re-design.
 */
export function createLocalKekSecretStore(opts: LocalKekOptions): SecretStore {
  if (opts.keys.size === 0) {
    throw new Error('createLocalKekSecretStore requires at least one key');
  }
  const active = opts.keys.get(opts.activeKid);
  if (!active) {
    throw new Error(
      `Active kid "${opts.activeKid}" is not present in the provided key set`,
    );
  }
  for (const [kid, key] of opts.keys) {
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `Key for kid "${kid}" must be ${KEY_BYTES} bytes; got ${key.length}`,
      );
    }
  }

  return {
    encrypt(plaintext) {
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv(ALGO, active, nonce);
      const ciphertext = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
      ]);
      const tag = cipher.getAuthTag();
      return [
        ENVELOPE_PREFIX,
        opts.activeKid,
        b64url(nonce),
        b64url(ciphertext),
        b64url(tag),
      ].join('.');
    },

    decrypt(value) {
      if (!isEnvelope(value)) return value;
      const [, kid, nonceEnc, ctEnc, tagEnc] = value.split('.');
      if (!kid || !nonceEnc || !ctEnc || !tagEnc) {
        throw new Error('Malformed secret envelope');
      }
      const key = opts.keys.get(kid);
      if (!key) {
        // Surface the kid so an operator with a rotation window can
        // tell which master key is missing from the config.
        throw new Error(`Unknown secret kid "${kid}"`);
      }
      const nonce = b64urlDecode(nonceEnc);
      const ciphertext = b64urlDecode(ctEnc);
      const tag = b64urlDecode(tagEnc);
      if (nonce.length !== NONCE_BYTES) {
        throw new Error('Malformed secret envelope (nonce size)');
      }
      if (tag.length !== TAG_BYTES) {
        throw new Error('Malformed secret envelope (tag size)');
      }
      const decipher = createDecipheriv(ALGO, key, nonce);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return plaintext.toString('utf8');
    },
  };
}

/**
 * Passthrough adapter. Used when no master key is configured — the
 * dashboard and widget still work, but `projects.identity_secret` and
 * `project_identity_secrets.secret` are stored plaintext. A `warnOnce`
 * log on first use keeps the operator aware.
 */
export function createPlaintextSecretStore(warn = true): SecretStore {
  let warned = !warn;
  const emit = () => {
    if (warned) return;
    warned = true;
    console.warn(
      '[koe/api] secret-at-rest encryption is DISABLED — set KOE_SECRET_KEYS + ' +
        'KOE_SECRET_ACTIVE_KID to enable AES-256-GCM envelope encryption.',
    );
  };
  return {
    encrypt(plaintext) {
      emit();
      return plaintext;
    },
    decrypt(value) {
      return value;
    },
  };
}

/**
 * Reads `KOE_SECRET_KEYS` / `KOE_SECRET_ACTIVE_KID` from env and builds
 * the matching `SecretStore`. Format of `KOE_SECRET_KEYS`:
 *
 *     kid1:<base64-32-bytes>,kid2:<base64-32-bytes>
 *
 * Operators generate each key with something like
 * `openssl rand -base64 32`. A missing / empty env falls back to the
 * plaintext store (dev-only, logs a warning).
 *
 * Memoised: boot once, reuse forever within the process.
 */
let cached: SecretStore | null = null;
export function getSecretStoreFromEnv(): SecretStore {
  if (cached) return cached;

  const raw = process.env.KOE_SECRET_KEYS?.trim();
  const activeKid = process.env.KOE_SECRET_ACTIVE_KID?.trim();
  if (!raw || !activeKid) {
    cached = createPlaintextSecretStore();
    return cached;
  }

  const keys = new Map<string, Buffer>();
  for (const entry of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const i = entry.indexOf(':');
    if (i <= 0 || i === entry.length - 1) {
      throw new Error(`Malformed KOE_SECRET_KEYS entry "${entry}" — expected kid:base64`);
    }
    const kid = entry.slice(0, i).trim();
    const keyB64 = entry.slice(i + 1).trim();
    const key = Buffer.from(keyB64, 'base64');
    keys.set(kid, key);
  }
  cached = createLocalKekSecretStore({ keys, activeKid });
  return cached;
}

/** Test-only hook to reset the memoised store between suites. */
export function __resetSecretStoreCacheForTest(): void {
  cached = null;
}

export function isEnvelope(value: string): boolean {
  return value.startsWith(`${ENVELOPE_PREFIX}.`);
}

/**
 * Extracts the `kid` from a v1 envelope blob, or returns `null` if
 * the value isn't an envelope. Used by the `rotate-secrets` CLI to
 * decide whether a row needs re-encryption under the current active
 * kid, without having to decrypt the payload first.
 */
export function readEnvelopeKid(value: string): string | null {
  if (!isEnvelope(value)) return null;
  const parts = value.split('.');
  if (parts.length !== 5) return null;
  const kid = parts[1];
  return kid && kid.length > 0 ? kid : null;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Buffer {
  const padLen = (4 - (s.length % 4)) % 4;
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLen), 'base64');
}
