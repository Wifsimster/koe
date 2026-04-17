import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signed identity token — the v2 replacement for the bare
 * `X-Koe-User-Hash` scheme.
 *
 * Wire format: `base64url(payloadJson).hex(hmacSha256(secret, payloadJson))`
 * Transport:   header `X-Koe-Identity-Token`.
 *
 * What v2 adds over v1:
 * - Binds the signature to `projectId`, `iat`, `nonce`, and `kid` so a
 *   captured hash is not valid across projects, sessions, or forever.
 * - `iat` + TTL kills long-lived replay. Default window is 10 minutes.
 * - `nonce` dedupe kills in-window replay.
 * - `kid` enables non-breaking rotation: a project can have multiple
 *   `active` secrets at once, tokens carry the `kid` they were signed
 *   under, and the verifier picks the right secret.
 *
 * What v2 does NOT do:
 * - It does not encrypt the payload. Reporter ids are visible in the
 *   token. Treat them as pseudonymous, not secret.
 * - It does not authenticate the host itself beyond possession of the
 *   signing secret — same trust model as v1.
 */

export interface IdentityTokenPayload {
  reporterId: string;
  projectId: string;
  /** Seconds since epoch. Enforced against `now - maxAgeSeconds`. */
  iat: number;
  /** Caller-provided opaque string; dedup'd against the nonce cache. */
  nonce: string;
  /** Secret version the token was signed under. */
  kid: string;
}

export interface IdentitySecret {
  kid: string;
  secret: string;
  /** Only `active` and `retiring` secrets verify. `revoked` is rejected. */
  status: 'active' | 'retiring' | 'revoked';
}

export interface NonceCache {
  /**
   * Returns `true` if `key` was already seen (i.e. this is a replay).
   * Records the key on miss. Must be idempotent for concurrent callers
   * of the same key — either both see `true` or the first wins; never
   * both see `false`.
   *
   * Async so a Redis-backed adapter can slot in without changing the
   * contract. The in-memory adapter resolves synchronously (wrapped in
   * a promise) so there's no perf tax on the dev path.
   */
  hasSeen(key: string): Promise<boolean>;
}

export type VerifyError =
  | 'malformed'
  | 'signature_mismatch'
  | 'unknown_kid'
  | 'revoked_kid'
  | 'token_expired'
  | 'token_in_future'
  | 'replayed_nonce'
  | 'project_mismatch'
  | 'reporter_mismatch';

export interface VerifyOptions {
  /** Accept `iat` within [now - maxAgeSeconds, now + clockSkewSeconds]. */
  maxAgeSeconds: number;
  /** Tolerance for clock drift on the signing side. */
  clockSkewSeconds?: number;
  /** Current time in seconds since epoch. Injected for testability. */
  now?: () => number;
  /** Expected project id — rejects tokens signed for another project. */
  expectedProjectId: string;
  /** Expected reporter id — rejects tokens for another reporter. */
  expectedReporterId: string;
  /** Nonce cache for replay protection. */
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

/**
 * Produces a signed token for the given payload. Exported for the API's
 * own use (tests, future dev tooling). Host apps will usually
 * reimplement this one-liner in their own stack — the algorithm is
 * stable and fully documented here.
 */
export function signIdentityToken(payload: IdentityTokenPayload, secret: string): string {
  const json = JSON.stringify(payload);
  const encoded = base64UrlEncode(json);
  const mac = sign(json, secret);
  return `${encoded}.${mac}`;
}

/**
 * Verifies a token against a project's known secrets. Returns the parsed
 * payload on success or a typed error on failure. Never throws on
 * attacker-controlled input.
 */
export async function verifyIdentityToken(
  token: string,
  secretsByKid: Map<string, IdentitySecret>,
  opts: VerifyOptions,
): Promise<
  { ok: true; payload: IdentityTokenPayload } | { ok: false; reason: VerifyError }
> {
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) {
    return { ok: false, reason: 'malformed' };
  }
  const encoded = token.slice(0, dot);
  const mac = token.slice(dot + 1);

  const json = base64UrlDecode(encoded);
  if (json === null) return { ok: false, reason: 'malformed' };

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
      return { ok: false, reason: 'malformed' };
    }
    payload = parsed as IdentityTokenPayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  const entry = secretsByKid.get(payload.kid);
  if (!entry) return { ok: false, reason: 'unknown_kid' };
  if (entry.status === 'revoked') return { ok: false, reason: 'revoked_kid' };

  const expectedMac = sign(json, entry.secret);
  if (!hexEquals(expectedMac, mac)) {
    return { ok: false, reason: 'signature_mismatch' };
  }

  if (payload.projectId !== opts.expectedProjectId) {
    return { ok: false, reason: 'project_mismatch' };
  }
  if (payload.reporterId !== opts.expectedReporterId) {
    return { ok: false, reason: 'reporter_mismatch' };
  }

  const now = (opts.now ?? (() => Math.floor(Date.now() / 1000)))();
  const skew = opts.clockSkewSeconds ?? 30;
  if (payload.iat > now + skew) {
    return { ok: false, reason: 'token_in_future' };
  }
  if (payload.iat < now - opts.maxAgeSeconds) {
    return { ok: false, reason: 'token_expired' };
  }

  // Bind the nonce to the kid so collisions across rotated keys can't
  // mask a real replay.
  const nonceKey = `${payload.kid}:${payload.nonce}`;
  if (await opts.nonces.hasSeen(nonceKey)) {
    return { ok: false, reason: 'replayed_nonce' };
  }

  return { ok: true, payload };
}

/**
 * Bounded in-memory nonce cache. FIFO eviction at `capacity`. Good for
 * single-replica dev and small single-instance prod; swap for Redis in
 * the infra MR when we add a second replica.
 */
export function createInMemoryNonceCache(capacity = 10_000): NonceCache {
  const seen = new Set<string>();
  const order: string[] = [];

  return {
    async hasSeen(key) {
      if (seen.has(key)) return true;
      seen.add(key);
      order.push(key);
      if (order.length > capacity) {
        const evicted = order.shift();
        if (evicted !== undefined) seen.delete(evicted);
      }
      return false;
    },
  };
}

/**
 * Shape of a Redis client we rely on. Declared locally so this module
 * stays importable in environments without `ioredis` installed — the
 * Redis adapter factory is where the real client gets wired.
 */
export interface RedisSetNxClient {
  /**
   * `SET key value NX EX seconds`. Returns a non-null value (typically
   * `'OK'`) on first-write, `null` when the key already existed.
   * Widened from `'OK'` to any non-null so both `ioredis` and
   * `ioredis-mock` typings slot in without casts at the call site.
   */
  set(
    key: string,
    value: string,
    ...args: Array<string | number>
  ): Promise<unknown>;
}

export interface RedisNonceCacheOptions {
  /** Key prefix so we can safely share the Redis DB with other data. */
  prefix?: string;
  /**
   * TTL per stored key. Must be >= the token's `maxAgeSeconds` window,
   * otherwise a valid-but-recently-used token could replay after the
   * dedup entry expired. 900s (15 min) covers the default 10-minute
   * window with comfortable slack.
   */
  ttlSeconds?: number;
}

/**
 * Redis-backed nonce cache. Uses `SET NX EX` for atomic first-write
 * semantics — exactly one caller across all replicas sees the key as
 * unseen. Keys expire on their own so there's nothing to clean up.
 *
 * The cache is intentionally generous with TTL: a valid token's
 * nonce is remembered long enough that the token itself will have
 * expired by then, which is the only condition under which it would
 * be safe to reuse the same nonce anyway.
 */
export function createRedisNonceCache(
  client: RedisSetNxClient,
  opts: RedisNonceCacheOptions = {},
): NonceCache {
  const prefix = opts.prefix ?? 'koe:nonce:';
  const ttl = opts.ttlSeconds ?? 900;

  return {
    async hasSeen(key) {
      // ioredis accepts NX/EX as positional flags. `SET k v NX EX ttl`
      // returns 'OK' if we stored it, null if the key already existed.
      const result = await client.set(`${prefix}${key}`, '1', 'NX', 'EX', ttl);
      return result === null;
    },
  };
}

/**
 * Picks the Redis nonce cache when `REDIS_URL` is set, falls back to
 * in-memory otherwise. Call once at module load; the returned cache
 * is safe to share across the whole process.
 *
 * Kept separate from the adapter factories so unit tests can still
 * instantiate the in-memory cache directly without pulling in
 * ioredis.
 */
export function createNonceCacheFromEnv(
  redis: RedisSetNxClient | null,
  opts: { capacity?: number; redisOpts?: RedisNonceCacheOptions } = {},
): NonceCache {
  if (redis) return createRedisNonceCache(redis, opts.redisOpts);
  return createInMemoryNonceCache(opts.capacity);
}
