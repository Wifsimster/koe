import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { ok, fail } from '../lib/response';
import { hashPassword, verifyPassword } from '../lib/password';
import { ADMIN_COOKIE_NAME, mintSessionCookie } from '../middleware/adminAuth';
import { clientIp, createRateLimiterFromEnv, rateLimit } from '../middleware/rateLimit';

/**
 * Login routes for the single admin. Mounted at `/v1/admin/auth/*`.
 *
 *   POST /login  → verifies ADMIN_EMAIL + ADMIN_PASSWORD_HASH, sets cookie
 *   POST /logout → clears cookie (stateless, no server-side revoke)
 *
 * Credentials live in env vars only — no admin_users table. Rotating
 * the password is an env change + redeploy; rotating the session
 * secret kicks every browser out on the next request.
 */

export interface PasswordAuthConfig {
  sessionTtlDays: number;
  secureCookies: boolean;
}

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(1).max(4096),
});

/**
 * Hashed form of a sentinel value, precomputed at module load so the
 * login endpoint's response time doesn't reveal whether the email
 * matched the admin. A lazy first-call compute would make the first
 * non-admin-email request measurably slower than the admin-email path;
 * warming the promise here makes both paths pay the same cost.
 */
const dummyHashPromise: Promise<string> = hashPassword(
  'koe-login-dummy-' + Math.random().toString(36),
);
function getDummyHash(): Promise<string> {
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
    const body = await c.req.json().catch(() => null);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return fail(c, 'validation_failed', 'Invalid login payload', 422, {
        issues: parsed.error.issues,
      });
    }

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
    deleteCookie(c, ADMIN_COOKIE_NAME, { path: '/', secure: cfg.secureCookies });
    return ok(c, { ok: true });
  });

  return app;
}
