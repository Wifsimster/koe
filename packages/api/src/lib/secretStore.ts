import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface SecretStore {
  encrypt(plaintext: string): string;
  decrypt(value: string): string;
}

export const ENVELOPE_PREFIX = 'koe1';
const ALGO = 'aes-256-gcm';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export interface LocalKekOptions {
  keys: Map<string, Buffer>;
  activeKid: string;
}

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

export function __resetSecretStoreCacheForTest(): void {
  cached = null;
}

export function isEnvelope(value: string): boolean {
  return value.startsWith(`${ENVELOPE_PREFIX}.`);
}

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
