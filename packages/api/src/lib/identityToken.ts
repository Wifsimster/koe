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

/**
 * Reason returned to the caller. Granular kid/sig failures are collapsed
 * to a single `signature_mismatch` so an attacker probing the endpoint
 * can't tell unknown-kid from revoked-kid from bad-mac. The granular
 * cause is exposed via `internalReason` for server-side logging only —
 * callers MUST NOT include it in any client-facing payload.
 */
export type VerifyError =
  | 'malformed'
  | 'signature_mismatch'
  | 'token_expired'
  | 'token_in_future'
  | 'replayed_nonce'
  | 'project_mismatch'
  | 'reporter_mismatch';

/** Granular failure detail for logs. Never returned to the client. */
export type VerifyInternalReason =
  | VerifyError
  | 'unknown_kid'
  | 'revoked_kid';

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
 * Fixed dummy secret used when the token's `kid` is unknown or revoked.
 * Same length/shape as a real secret so the HMAC compare runs in the
 * same time budget and the server's response time can't be used to
 * fingerprint kid validity. The compare will never match (the dummy is
 * not in any project's secret list), so the `signature_mismatch`
 * branch always wins.
 */
const DUMMY_HMAC_SECRET =
  'koe-dummy-secret-for-constant-time-hmac-compare-never-shipped';

/**
 * Verifies a token against a project's known secrets. Returns the parsed
 * payload on success or a typed error on failure. Never throws on
 * attacker-controlled input.
 *
 * Failure-reason policy:
 * - `reason` (callers may surface to client) collapses unknown-kid,
 *   revoked-kid, and bad-mac into `signature_mismatch`. An attacker
 *   probing the endpoint learns nothing they couldn't learn from a
 *   garbage-byte attempt.
 * - `internalReason` (logs only) keeps the granular cause for ops
 *   debugging. Middleware MUST NOT echo it in the 401 body.
 *
 * Timing policy: the HMAC compare runs unconditionally even when the
 * `kid` is unknown or revoked, with a fixed dummy secret of the same
 * length so a timing oracle can't distinguish the kid-resolution
 * outcome from a real signature-mismatch outcome.
 */
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

  // Resolve the secret, but always run the HMAC compare. Unknown or
  // revoked kids fall through with the dummy secret so the timing of
  // the compare doesn't depend on the resolution outcome.
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
    // Even if the dummy compare somehow matched (it cannot in practice),
    // the kid is bad — collapse to signature_mismatch externally.
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

  // Bind the nonce to the kid so collisions across rotated keys can't
  // mask a real replay.
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
  /**
   * How long an entry is remembered before it can be evicted. Must be
   * >= the verifier's `maxAgeSeconds` so a still-valid token can't
   * replay after its dedup record expired. Default 900s (15 min)
   * matches the Redis adapter and covers the 10-min default window.
   */
  ttlSeconds?: number;
  /**
   * Bounded sweep size per insert — we expire at most this many keys
   * on any single `hasSeen` call so a flood of inserts can't degenerate
   * into an O(n) walk of the entire map. Sweeping just a chunk keeps
   * each insert O(1) amortised; expired-but-not-yet-swept entries take
   * no extra memory beyond the entry itself.
   */
  sweepBatchSize?: number;
  /** Injected clock for tests. Defaults to Date.now. */
  now?: () => number;
}

/**
 * In-memory nonce cache with **TTL-based** eviction.
 *
 * Each insert records `{ key -> expiresAt }`. A small bounded sweep
 * runs on every insert to retire already-expired entries; relying on
 * insertion order in `Map` keeps the sweep an O(k) walk over the
 * oldest entries. There is **no capacity cap** — a flood of fresh
 * nonces cannot push out a still-valid replay-protection entry within
 * its TTL window, which is the property an attacker would otherwise
 * exploit to replay a captured token.
 *
 * Memory bound: at the steady-state insert rate `r` (nonces/sec) the
 * map size stays around `r * ttlSeconds`. For the default 15-minute
 * TTL, even 100 nonces/sec yields ~90k entries — small enough that
 * the cap dropped from the previous FIFO implementation isn't a
 * practical concern. If you do hit an unusually high steady rate,
 * switch to the Redis adapter (which expires keys in the server).
 */
export function createInMemoryNonceCache(opts: InMemoryNonceCacheOptions = {}): NonceCache {
  const ttlMs = (opts.ttlSeconds ?? 900) * 1000;
  const sweepBatch = opts.sweepBatchSize ?? 32;
  const now = opts.now ?? (() => Date.now());

  // Map iteration order is insertion order, so iterating from the
  // start finds the oldest (earliest-expiring) entries first.
  const seen = new Map<string, number>();

  function sweep(currentMs: number): void {
    let swept = 0;
    for (const [key, expiresAt] of seen) {
      if (swept >= sweepBatch) break;
      if (expiresAt > currentMs) break; // remaining entries are newer/younger
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
      // Re-insert (or insert) so this key moves to the back of the
      // insertion-order iteration — keeps the sweep walking from the
      // genuinely-oldest end.
      if (existing !== undefined) seen.delete(key);
      seen.set(key, currentMs + ttlMs);
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
  opts: { memoryOpts?: InMemoryNonceCacheOptions; redisOpts?: RedisNonceCacheOptions } = {},
): NonceCache {
  if (redis) return createRedisNonceCache(redis, opts.redisOpts);
  return createInMemoryNonceCache(opts.memoryOpts);
}
