import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { ok, fail } from '../lib/response';
import { loginSchema } from '../lib/schemas';
import { parseJsonBody } from '../lib/validation';
import { hashPassword, verifyPassword } from '../lib/password';
import {
  ADMIN_COOKIE_NAME,
  mintSessionCookie,
  recordAdminSession,
  revokeAdminSession,
} from '../middleware/adminAuth';
import { clientIp, createRateLimiterFromEnv, rateLimit } from '../middleware/rateLimit';

/**
 * Login routes for the single admin. Mounted at `/v1/admin/auth/*`.
 *
 *   POST /login  → verifies ADMIN_EMAIL + ADMIN_PASSWORD_HASH, sets cookie,
 *                  records the session in `admin_sessions` (DB-backed revoke)
 *   POST /logout → clears cookie and deletes the matching `admin_sessions` row
 *
 * Credentials live in env vars only — no admin_users table. Rotating
 * the password is an env change + redeploy; rotating the session
 * secret kicks every browser out on the next request.
 */

export interface PasswordAuthConfig {
  sessionTtlDays: number;
  secureCookies: boolean;
}

/**
 * Hashed form of a sentinel value, used so the login endpoint's
 * response time doesn't reveal whether the email matched the admin.
 *
 * Lazy singleton: we used to kick off `hashPassword(...)` at module
 * load, but a synchronous throw from `hashPassword` (native binding
 * misload, missing wasm fallback, etc.) would crash the whole
 * `passwordAuth` module import — which in turn cascades into the
 * `/v1/admin/auth/*` mount and takes down the entire admin surface
 * before the first request even arrives. Deferring the compute to the
 * first login attempt isolates the failure mode to a single request,
 * with a clean 401/500 path, and still amortises the cost across
 * subsequent attempts via the cached promise.
 */
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  if (dummyHashPromise) return dummyHashPromise;
  // Cache the promise (not the resolved value) so concurrent first
  // requests share one argon2 invocation. Random salt input ensures
  // the dummy hash isn't a stable target across deployments.
  dummyHashPromise = hashPassword('koe-login-dummy-' + Math.random().toString(36));
  return dummyHashPromise;
}

export function createAuthRoutes(cfg: PasswordAuthConfig): Hono {
  const app = new Hono();

  // 5 attempts per minute per client IP. Same bucket for logout since
  // it's cheap and the limiter is simpler with one key pattern.
  const limiter = createRateLimiterFromEnv({
    refillPerSecond: 5 / 60,
    capacity: 5,
    prefix: 'koe:rl:admin-auth:',
  });
  const rateGate = rateLimit({
    refillPerSecond: 5 / 60,
    capacity: 5,
    limiter,
    key: (c) => `ip:${clientIp(c)}`,
  });

  app.post('/login', rateGate, async (c) => {
    const parsed = await parseJsonBody(c, loginSchema, 'Invalid login payload');
    if (!parsed.ok) return parsed.response;

    const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const adminHash = process.env.ADMIN_PASSWORD_HASH;
    if (!adminEmail || !adminHash) {
      return fail(c, 'service_unavailable', 'Admin auth is not configured', 503);
    }

    const emailMatches = parsed.data.email === adminEmail;
    // Verify against either the real hash or a dummy so timing
    // doesn't disclose whether the email matches the admin.
    const hashToCheck = emailMatches ? adminHash : await getDummyHash();
    const passwordMatches = await verifyPassword(hashToCheck, parsed.data.password);

    if (!emailMatches || !passwordMatches) {
      return fail(c, 'unauthorized', 'Invalid email or password', 401);
    }

    const expiresAtMs = Date.now() + cfg.sessionTtlDays * 24 * 60 * 60 * 1000;
    const cookieValue = mintSessionCookie(expiresAtMs);
    await recordAdminSession(cookieValue, expiresAtMs);

    setCookie(c, ADMIN_COOKIE_NAME, cookieValue, {
      httpOnly: true,
      secure: cfg.secureCookies,
      sameSite: 'Lax',
      path: '/',
      expires: new Date(expiresAtMs),
    });

    return ok(c, { email: adminEmail });
  });

  app.post('/logout', async (c) => {
    const existing = getCookie(c, ADMIN_COOKIE_NAME);
    if (existing) {
      await revokeAdminSession(existing);
    }
    deleteCookie(c, ADMIN_COOKIE_NAME, { path: '/', secure: cfg.secureCookies });
    return ok(c, { ok: true });
  });

  return app;
}
