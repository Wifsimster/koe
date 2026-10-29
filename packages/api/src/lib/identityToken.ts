import { createHmac, timingSafeEqual } from 'node:crypto';

export interface IdentityTokenPayload {
  reporterId: string;
  projectId: string;
  iat: number;
  nonce: string;
  kid: string;
}

export interface IdentitySecret {
  kid: string;
  secret: string;
  status: 'active' | 'retiring' | 'revoked';
}

export interface NonceCache {
  hasSeen(key: string): Promise<boolean>;
}

export type VerifyError =
  | 'malformed'
  | 'signature_mismatch'
  | 'token_expired'
  | 'token_in_future'
  | 'replayed_nonce'
  | 'project_mismatch'
  | 'reporter_mismatch';

export type VerifyInternalReason =
  | VerifyError
  | 'unknown_kid'
  | 'revoked_kid';

export interface VerifyOptions {
  maxAgeSeconds: number;
  clockSkewSeconds?: number;
  now?: () => number;
  expectedProjectId: string;
  expectedReporterId: string;
  nonces: NonceCache;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(input: string): string | null {
  const padLen = (4 - (input.length % 4)) % 4;
  const padded = input + '='.repeat(padLen);
  const normalized = padded.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return Buffer.from(normalized, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

function hexEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

function sign(payloadJson: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadJson).digest('hex');
}

export function signIdentityToken(payload: IdentityTokenPayload, secret: string): string {
  const json = JSON.stringify(payload);
  const encoded = base64UrlEncode(json);
  const mac = sign(json, secret);
  return `${encoded}.${mac}`;
}

const DUMMY_HMAC_SECRET =
  'koe-dummy-secret-for-constant-time-hmac-compare-never-shipped';

export async function verifyIdentityToken(
  token: string,
  secretsByKid: Map<string, IdentitySecret>,
  opts: VerifyOptions,
): Promise<
  | { ok: true; payload: IdentityTokenPayload }
  | { ok: false; reason: VerifyError; internalReason: VerifyInternalReason }
> {
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) {
    return { ok: false, reason: 'malformed', internalReason: 'malformed' };
  }
  const encoded = token.slice(0, dot);
  const mac = token.slice(dot + 1);

  const json = base64UrlDecode(encoded);
  if (json === null) {
    return { ok: false, reason: 'malformed', internalReason: 'malformed' };
  }

  let payload: IdentityTokenPayload;
  try {
    const parsed = JSON.parse(json) as Partial<IdentityTokenPayload>;
    if (
      typeof parsed.reporterId !== 'string' ||
      typeof parsed.projectId !== 'string' ||
      typeof parsed.iat !== 'number' ||
      typeof parsed.nonce !== 'string' ||
      typeof parsed.kid !== 'string'
    ) {
      return { ok: false, reason: 'malformed', internalReason: 'malformed' };
    }
    payload = parsed as IdentityTokenPayload;
  } catch {
    return { ok: false, reason: 'malformed', internalReason: 'malformed' };
  }

  const entry = secretsByKid.get(payload.kid);
  let secretToUse: string;
  let kidIssue: 'unknown_kid' | 'revoked_kid' | null = null;
  if (!entry) {
    secretToUse = DUMMY_HMAC_SECRET;
    kidIssue = 'unknown_kid';
  } else if (entry.status === 'revoked') {
    secretToUse = DUMMY_HMAC_SECRET;
    kidIssue = 'revoked_kid';
  } else {
    secretToUse = entry.secret;
  }

  const expectedMac = sign(json, secretToUse);
  const macOk = hexEquals(expectedMac, mac);

  if (kidIssue) {
    return { ok: false, reason: 'signature_mismatch', internalReason: kidIssue };
  }
  if (!macOk) {
    return {
      ok: false,
      reason: 'signature_mismatch',
      internalReason: 'signature_mismatch',
    };
  }

  if (payload.projectId !== opts.expectedProjectId) {
    return {
      ok: false,
      reason: 'project_mismatch',
      internalReason: 'project_mismatch',
    };
  }
  if (payload.reporterId !== opts.expectedReporterId) {
    return {
      ok: false,
      reason: 'reporter_mismatch',
      internalReason: 'reporter_mismatch',
    };
  }

  const now = (opts.now ?? (() => Math.floor(Date.now() / 1000)))();
  const skew = opts.clockSkewSeconds ?? 30;
  if (payload.iat > now + skew) {
    return {
      ok: false,
      reason: 'token_in_future',
      internalReason: 'token_in_future',
    };
  }
  if (payload.iat < now - opts.maxAgeSeconds) {
    return {
      ok: false,
      reason: 'token_expired',
      internalReason: 'token_expired',
    };
  }

  const nonceKey = `${payload.kid}:${payload.nonce}`;
  if (await opts.nonces.hasSeen(nonceKey)) {
    return {
      ok: false,
      reason: 'replayed_nonce',
      internalReason: 'replayed_nonce',
    };
  }

  return { ok: true, payload };
}

export interface InMemoryNonceCacheOptions {
  ttlSeconds?: number;
  sweepBatchSize?: number;
  now?: () => number;
}

export function createInMemoryNonceCache(opts: InMemoryNonceCacheOptions = {}): NonceCache {
  const ttlMs = (opts.ttlSeconds ?? 900) * 1000;
  const sweepBatch = opts.sweepBatchSize ?? 32;
  const now = opts.now ?? (() => Date.now());

  const seen = new Map<string, number>();

  function sweep(currentMs: number): void {
    let swept = 0;
    for (const [key, expiresAt] of seen) {
      if (swept >= sweepBatch) break;
      if (expiresAt > currentMs) break;
      seen.delete(key);
      swept++;
    }
  }

  return {
    async hasSeen(key) {
      const currentMs = now();
      sweep(currentMs);

      const existing = seen.get(key);
      if (existing !== undefined && existing > currentMs) {
        return true;
      }
      if (existing !== undefined) seen.delete(key);
      seen.set(key, currentMs + ttlMs);
      return false;
    },
  };
}

export interface RedisSetNxClient {
  set(
    key: string,
    value: string,
    ...args: Array<string | number>
  ): Promise<unknown>;
}

export interface RedisNonceCacheOptions {
  prefix?: string;
  ttlSeconds?: number;
}

export function createRedisNonceCache(
  client: RedisSetNxClient,
  opts: RedisNonceCacheOptions = {},
): NonceCache {
  const prefix = opts.prefix ?? 'koe:nonce:';
  const ttl = opts.ttlSeconds ?? 900;

  return {
    async hasSeen(key) {
      const result = await client.set(`${prefix}${key}`, '1', 'NX', 'EX', ttl);
      return result === null;
    },
  };
}

export function createNonceCacheFromEnv(
  redis: RedisSetNxClient | null,
  opts: { memoryOpts?: InMemoryNonceCacheOptions; redisOpts?: RedisNonceCacheOptions } = {},
): NonceCache {
  if (redis) return createRedisNonceCache(redis, opts.redisOpts);
  return createInMemoryNonceCache(opts.memoryOpts);
}
