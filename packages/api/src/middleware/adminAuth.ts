import { createHmac, timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { fail } from '../lib/response';

/**
 * Solo-admin authentication.
 *
 * Koe is a single-operator dashboard — one founder managing multiple
 * of their own SaaS projects. There is no users table, no sessions
 * table, no teams, no roles. The only identity question is "is this
 * the admin?" and the answer lives in env vars: ADMIN_EMAIL +
 * ADMIN_PASSWORD_HASH (argon2id) verified at login, then a signed
 * cookie carries the session forward.
 *
 * The cookie value is `${expiresAtMs}.${hmac}` where `hmac` is
 * HMAC-SHA256(ADMIN_SESSION_SECRET, expiresAtMs). Stateless: no DB
 * lookup on each request, no session store to clean up. Rotating
 * ADMIN_SESSION_SECRET invalidates every outstanding cookie, which
 * is the "kick myself out" button for the founder.
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

/** Build the cookie value for a session that expires at `expiresAtMs`. */
export function mintSessionCookie(expiresAtMs: number): string {
  const secret = requireSessionSecret();
  const payload = String(expiresAtMs);
  return `${payload}.${sign(payload, secret)}`;
}

/** Verify a cookie value. Returns the expiry on success, null on any failure. */
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
 * Admin-only gate. Reads the `koe_admin` cookie, verifies the HMAC,
 * and attaches `admin.email` to the context. Returns 401 on any
 * failure without leaking why — the attacker probing the endpoint
 * learns nothing from "missing" vs "expired" vs "bad signature".
 */
export const requireAdmin: MiddlewareHandler<{ Variables: AdminContext }> = async (c, next) => {
  const email = process.env.ADMIN_EMAIL;
  if (!email) {
    return fail(c, 'service_unavailable', 'Admin auth is not configured', 503);
  }
  const expiresAtMs = verifySessionCookie(getCookie(c, ADMIN_COOKIE_NAME));
  if (!expiresAtMs) {
    return fail(c, 'unauthorized', 'Admin session required', 401);
  }
  c.set('admin', { email });
  await next();
};
