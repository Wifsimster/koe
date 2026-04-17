import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db';
import { ok, fail } from '../lib/response';
import { hashPassword, verifyPassword } from '../lib/password';
import { createRawSessionToken, hashSessionToken } from '../middleware/adminAuth';
import { clientIp, createRateLimiterFromEnv, rateLimit } from '../middleware/rateLimit';

/**
 * Email + password login routes mounted at `/v1/admin/auth/*` when
 * `ADMIN_AUTH_MODE=password`.
 *
 *   POST /password → verifies credentials, issues a session cookie
 *   POST /logout   → revokes the session, clears the cookie
 *
 * Identical cookie + `admin_sessions` shape as the OIDC callback, so
 * `requireAdminSession` stays provider-agnostic and the SPA flow doesn't
 * change between modes.
 *
 * Kept as a sibling of `oidcAuth.ts` rather than folded into it: the
 * two are different trust paths and the overlap is only a few lines of
 * session-mint glue. A single shared helper for the mint step (see
 * `issueSession`) keeps them honest.
 */

export interface PasswordAuthConfig {
  cookieName: string;
  sessionTtlDays: number;
  secureCookies: boolean;
}

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(1).max(4096),
});

/**
 * Hashed form of a sentinel value, computed lazily at first use. When
 * the submitted email doesn't match any user, we still verify against
 * this hash so the login endpoint's response time doesn't reveal
 * whether the email exists. The sentinel never matches a real password
 * because the DB never stores its plaintext — only this one-time-hashed
 * string held in memory.
 */
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword('koe-login-dummy-' + Math.random().toString(36));
  }
  return dummyHashPromise;
}

export function createPasswordAuthRoutes(cfg: PasswordAuthConfig): Hono {
  const app = new Hono();

  // 5 attempts per minute per client IP. The limiter is shared
  // across both login and logout even though logout is cheap — a
  // single bucket is easier to reason about, and a logged-in user
  // won't hit the cap.
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

  app.post('/password', rateGate, async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return fail(c, 'validation_failed', 'Invalid login payload', 422, {
        issues: parsed.error.issues,
      });
    }

    const { email, password } = parsed.data;

    const [user] = await db
      .select({
        id: schema.adminUsers.id,
        email: schema.adminUsers.email,
        displayName: schema.adminUsers.displayName,
        passwordHash: schema.adminUsers.passwordHash,
      })
      .from(schema.adminUsers)
      .where(eq(schema.adminUsers.email, email))
      .limit(1);

    // Verify against either the real hash or a dummy so the timing
    // signal doesn't disclose account existence. Users that exist but
    // have no password_hash (e.g. OIDC-only) fall into the dummy path
    // too — login with password is explicitly unsupported for them.
    const hashToCheck = user?.passwordHash ?? (await getDummyHash());
    const matched = await verifyPassword(hashToCheck, password);

    if (!user || !user.passwordHash || !matched) {
      return fail(c, 'unauthorized', 'Invalid email or password', 401);
    }

    const rawToken = createRawSessionToken();
    const tokenHash = hashSessionToken(rawToken);
    const expiresAt = new Date(Date.now() + cfg.sessionTtlDays * 24 * 60 * 60 * 1000);

    await db.insert(schema.adminSessions).values({
      userId: user.id,
      tokenHash,
      expiresAt,
    });

    // Same cookie shape as the OIDC callback so `requireAdminSession`
    // treats both transports identically.
    setCookie(c, cfg.cookieName, rawToken, {
      httpOnly: true,
      secure: cfg.secureCookies,
      sameSite: 'Lax',
      path: '/',
      expires: expiresAt,
    });

    return ok(c, {
      user: { id: user.id, email: user.email, displayName: user.displayName },
    });
  });

  app.post('/logout', async (c) => {
    const token = getCookie(c, cfg.cookieName);
    if (token) {
      const hash = hashSessionToken(token);
      await db.delete(schema.adminSessions).where(eq(schema.adminSessions.tokenHash, hash));
    }
    deleteCookie(c, cfg.cookieName, {
      path: '/',
      secure: cfg.secureCookies,
    });
    return ok(c, { ok: true });
  });

  return app;
}
