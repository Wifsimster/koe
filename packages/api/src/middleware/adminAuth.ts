import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { and, eq, gt, lte } from 'drizzle-orm';
import { db, dbAvailable, schema } from '../db';
import { fail } from '../lib/response';

/**
 * Admin authentication.
 *
 * Wire format: `${expiresAtMs}.${hmac}` where `hmac` is
 * HMAC-SHA256(ADMIN_SESSION_SECRET, expiresAtMs). The HMAC keeps the
 * cookie tamper-evident; rotating ADMIN_SESSION_SECRET invalidates every
 * outstanding cookie at once.
 *
 * Server-side, each minted cookie is also persisted as a SHA-256 hash in
 * `admin_sessions` along with its expiry. `requireAdmin` looks up the
 * hash on every request, which gives us per-device revocation
 * (DELETE one row) without nuking every browser via secret rotation.
 *
 * The cookie plaintext is never stored — a DB dump leaks no active
 * credentials.
 *
 * Backwards compat: when `DATABASE_URL` is unset (typecheck/unit tests),
 * the middleware falls back to HMAC-only verification so the existing
 * test surface keeps working.
 *
 * Login (`passwordAuth.ts`) persists every session via
 * `recordAdminSession()` and logout removes it via
 * `revokeAdminSession()`, so `requireAdmin` requires a live
 * `admin_sessions` row — there is no trust-on-first-use fallback. A
 * cookie with no matching row (logged out, revoked, or forged) is
 * rejected, which is what makes server-side logout actually effective.
 */

export interface AdminContext {
  admin: { email: string };
}

export const ADMIN_COOKIE_NAME = 'koe_admin';

function requireSessionSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'ADMIN_SESSION_SECRET must be set to 32+ random bytes. ' +
        'Generate with `openssl rand -hex 32`.',
    );
  }
  return secret;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/** SHA-256 of the cookie value, hex-encoded. Used as the `admin_sessions` PK. */
export function hashSessionToken(cookieValue: string): string {
  return createHash('sha256').update(cookieValue).digest('hex');
}

/** Build the cookie value for a session that expires at `expiresAtMs`. */
export function mintSessionCookie(expiresAtMs: number): string {
  const secret = requireSessionSecret();
  const payload = String(expiresAtMs);
  return `${payload}.${sign(payload, secret)}`;
}

/** Verify HMAC envelope. Returns the expiry on success, null on any failure. */
export function verifySessionCookie(raw: string | undefined): number | null {
  if (!raw) return null;
  const dot = raw.indexOf('.');
  if (dot <= 0 || dot === raw.length - 1) return null;
  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expiresAtMs = Number(payload);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) return null;
  const expected = sign(payload, requireSessionSecret());
  return safeEqualHex(sig, expected) ? expiresAtMs : null;
}

/**
 * Record a freshly-minted cookie in `admin_sessions`. Call from the
 * login flow right after `mintSessionCookie`. Idempotent — a duplicate
 * insert (same hash) is silently ignored.
 *
 * No-ops when the DB isn't available (unit tests, typecheck).
 */
export async function recordAdminSession(cookieValue: string, expiresAtMs: number): Promise<void> {
  if (!dbAvailable) return;
  const tokenHash = hashSessionToken(cookieValue);
  await db
    .insert(schema.adminSessions)
    .values({ tokenHash, expiresAt: new Date(expiresAtMs) })
    .onConflictDoNothing();
}

/**
 * Revoke a session by its cookie value. Call from the logout flow.
 * Returns the number of rows deleted (0 or 1) so the caller can
 * distinguish "didn't exist" from "removed".
 */
export async function revokeAdminSession(cookieValue: string): Promise<number> {
  if (!dbAvailable) return 0;
  const tokenHash = hashSessionToken(cookieValue);
  const result = await db
    .delete(schema.adminSessions)
    .where(eq(schema.adminSessions.tokenHash, tokenHash))
    .returning({ tokenHash: schema.adminSessions.tokenHash });
  return result.length;
}

/**
 * Best-effort GC of expired rows. Cheap (indexed on `expires_at`) and
 * idempotent. Fired from `requireAdmin` once per process to keep the
 * table from growing unboundedly without scheduling a separate job.
 */
let lastGcAt = 0;
const GC_INTERVAL_MS = 60_000;
async function gcExpiredSessions(): Promise<void> {
  if (!dbAvailable) return;
  const now = Date.now();
  if (now - lastGcAt < GC_INTERVAL_MS) return;
  lastGcAt = now;
  try {
    await db.delete(schema.adminSessions).where(lte(schema.adminSessions.expiresAt, new Date()));
  } catch (err) {
    // GC is best-effort — never fail a request because of it.
    console.warn('[koe/api] admin_sessions GC failed', err);
  }
}

/**
 * Admin-only gate. Reads the `koe_admin` cookie, verifies the HMAC
 * envelope, and consults `admin_sessions` so a revoked row
 * (manual DELETE or via logout helper) immediately kicks the cookie
 * out. Returns 401 on any failure without leaking why.
 */
export const requireAdmin: MiddlewareHandler<{ Variables: AdminContext }> = async (c, next) => {
  const email = process.env.ADMIN_EMAIL;
  if (!email) {
    return fail(c, 'service_unavailable', 'Admin auth is not configured', 503);
  }
  const raw = getCookie(c, ADMIN_COOKIE_NAME);
  const expiresAtMs = verifySessionCookie(raw);
  if (!expiresAtMs || !raw) {
    return fail(c, 'unauthorized', 'Admin session required', 401);
  }

  if (dbAvailable) {
    const tokenHash = hashSessionToken(raw);
    const [row] = await db
      .select({ tokenHash: schema.adminSessions.tokenHash })
      .from(schema.adminSessions)
      .where(
        and(
          eq(schema.adminSessions.tokenHash, tokenHash),
          gt(schema.adminSessions.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!row) {
      // No live session row for this cookie. Login persists every
      // session via `recordAdminSession`, so the only ways to reach
      // here are a logout (row deleted), a manual revoke, or an
      // expired/forged cookie — all of which must be rejected. (An
      // earlier TOFU branch re-inserted such cookies "once"; that
      // predated login-time persistence and silently defeated
      // server-side logout, so it's been removed.)
      return fail(c, 'unauthorized', 'Admin session required', 401);
    }
    // Best-effort GC, throttled.
    void gcExpiredSessions();
  }

  c.set('admin', { email });
  await next();
};

/**
 * CSRF defence for admin mutations. `SameSite=Lax` on the session
 * cookie only blocks the most obvious cross-site POST — a sibling app
 * on the same registrable domain, or a browser that doesn't respect
 * Lax, still sends the cookie on cross-site fetches with
 * `credentials: 'include'`. This middleware closes that gap.
 *
 * Strategy: skip safe methods; on mutating methods, accept the
 * request only when `Sec-Fetch-Site` says same-origin/same-site/none
 * (modern browsers, always set), or — for clients that don't send the
 * Fetch Metadata header — when `Origin` matches `Host`. Rejects with
 * 403 otherwise. Same-origin deploys (dashboard at /admin on the same
 * Hono process) pass trivially; split deploys need to live on the
 * same registrable domain or add a reverse-proxy header rewrite.
 */
export const requireSameOrigin: MiddlewareHandler = async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }

  const fetchSite = c.req.header('Sec-Fetch-Site');
  if (fetchSite) {
    if (fetchSite === 'same-origin' || fetchSite === 'same-site' || fetchSite === 'none') {
      return next();
    }
    return fail(c, 'forbidden', 'Cross-site request denied', 403);
  }

  // Older browsers / non-browser clients: fall back to an Origin/Host
  // comparison. A missing Origin on a POST is treated as hostile —
  // every real browser attaches it to cross-origin fetches, and the
  // admin API has no legitimate no-Origin POST client.
  const origin = c.req.header('Origin');
  const host = c.req.header('Host');
  if (!origin || !host) {
    return fail(c, 'forbidden', 'Missing Origin on mutating request', 403);
  }
  try {
    if (new URL(origin).host !== host) {
      return fail(c, 'forbidden', 'Cross-origin request denied', 403);
    }
  } catch {
    return fail(c, 'forbidden', 'Malformed Origin header', 403);
  }
  return next();
};
