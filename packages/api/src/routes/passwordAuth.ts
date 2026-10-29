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

export interface PasswordAuthConfig {
  sessionTtlDays: number;
  secureCookies: boolean;
}

let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  if (dummyHashPromise) return dummyHashPromise;
  dummyHashPromise = hashPassword('koe-login-dummy-' + Math.random().toString(36));
  return dummyHashPromise;
}

export function createAuthRoutes(cfg: PasswordAuthConfig): Hono {
  const app = new Hono();

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
