import { Hono } from 'hono';
import {
  deleteCookie,
  getCookie,
  getSignedCookie,
  setCookie,
  setSignedCookie,
} from 'hono/cookie';
import { eq } from 'drizzle-orm';
import { db, firstOrThrow, schema } from '../db';
import { ok, fail } from '../lib/response';
import {
  createRawSessionToken,
  hashSessionToken,
} from '../middleware/adminAuth';
import type { OidcService, SavedAuthorizationState } from '../lib/oidc';

/**
 * OIDC login routes mounted at `/v1/admin/auth/*`.
 *
 *   GET  /login     → 302 to the provider's authorize URL
 *   GET  /callback  → validates, issues our session cookie,
 *                     redirects to the dashboard
 *   POST /logout    → clears cookie, revokes session, optional
 *                     provider-level logout redirect
 *
 * Session transport: the `adminAuth` middleware accepts either
 * `Authorization: Bearer <token>` (dev CLI path) or our cookie named
 * `OIDC_COOKIE_NAME` (browser path). The cookie value is the same raw
 * token the bearer header carries, so the server-side hash lookup is
 * identical regardless of transport.
 */

export interface OidcAuthConfig {
  oidc: OidcService;
  /** Base URL of the dashboard — post-callback redirect target. */
  dashboardUrl: string;
  /** Name of our session cookie. */
  cookieName: string;
  /** Session TTL, in days. */
  sessionTtlDays: number;
  /** Secret used to sign the transient state cookie + (re-used for
   *  Hono signed cookies on our session). */
  cookieSecret: string;
  /** Whether the cookies should be flagged `Secure`. Default true;
   *  disabled only for local HTTP dev. */
  secureCookies: boolean;
}

const STATE_COOKIE = 'koe_oidc_state';
const STATE_TTL_SECONDS = 600; // 10 min — long enough for the OIDC round-trip, short enough to limit replay.

export function createOidcAuthRoutes(cfg: OidcAuthConfig): Hono {
  const app = new Hono();

  // Public mode discovery. The SPA fetches this at boot to pick the
  // right login form without a build-time `VITE_ADMIN_AUTH_MODE` — a
  // single published image serves every auth mode.
  app.get('/config', (c) => ok(c, { mode: 'oidc' as const }));

  app.get('/login', async (c) => {
    const returnTo = c.req.query('redirect_to') ?? null;
    const safeReturnTo = sanitizeReturnTo(returnTo, cfg.dashboardUrl);

    const { authorizeUrl, state } = await cfg.oidc.beginLogin(safeReturnTo);

    await setSignedCookie(c, STATE_COOKIE, JSON.stringify(state), cfg.cookieSecret, {
      httpOnly: true,
      secure: cfg.secureCookies,
      sameSite: 'Lax',
      path: '/v1/admin/auth',
      maxAge: STATE_TTL_SECONDS,
    });

    return c.redirect(authorizeUrl, 302);
  });

  app.get('/callback', async (c) => {
    const rawState = await getSignedCookie(c, cfg.cookieSecret, STATE_COOKIE);
    if (!rawState) {
      return fail(c, 'unauthorized', 'Missing or tampered login state', 401);
    }

    let saved: SavedAuthorizationState;
    try {
      saved = JSON.parse(rawState) as SavedAuthorizationState;
    } catch {
      return fail(c, 'unauthorized', 'Corrupted login state', 401);
    }

    // Consume the state cookie regardless of success so a failed
    // attempt can't be retried against the same transient secrets.
    deleteCookie(c, STATE_COOKIE, {
      path: '/v1/admin/auth',
      secure: cfg.secureCookies,
    });

    const callbackUrl = new URL(c.req.url);

    let identity: Awaited<ReturnType<OidcService['finishLogin']>>;
    try {
      identity = await cfg.oidc.finishLogin(callbackUrl, saved);
    } catch (err) {
      console.warn('[koe/api] oidc callback failed', err);
      return fail(c, 'unauthorized', 'Login verification failed', 401);
    }

    // Upsert the admin user by email. Two statements rather than
    // ON CONFLICT because Postgres' conflict target on a unique text
    // column combined with partial update is verbose in Drizzle.
    const [existing] = await db
      .select()
      .from(schema.adminUsers)
      .where(eq(schema.adminUsers.email, identity.email))
      .limit(1);

    const user =
      existing ??
      firstOrThrow(
        await db
          .insert(schema.adminUsers)
          .values({ email: identity.email, displayName: identity.displayName })
          .returning(),
      );

    // Update displayName if it changed since last login — keeps the
    // dashboard fresh when someone updates their name on the IdP.
    if (existing && identity.displayName && identity.displayName !== existing.displayName) {
      await db
        .update(schema.adminUsers)
        .set({ displayName: identity.displayName })
        .where(eq(schema.adminUsers.id, existing.id));
    }

    const rawToken = createRawSessionToken();
    const tokenHash = hashSessionToken(rawToken);
    const expiresAt = new Date(Date.now() + cfg.sessionTtlDays * 24 * 60 * 60 * 1000);

    await db.insert(schema.adminSessions).values({
      userId: user.id,
      tokenHash,
      expiresAt,
    });

    // Session cookie. Path `/` so the same cookie is sent to the SPA
    // at `/admin/*` and to the API at `/v1/admin/*`. Unsigned on
    // purpose — the value is already 256 bits of entropy and the
    // server hashes it against admin_sessions.token_hash.
    setCookie(c, cfg.cookieName, rawToken, {
      httpOnly: true,
      secure: cfg.secureCookies,
      sameSite: 'Lax',
      path: '/',
      expires: expiresAt,
    });

    const target = saved.returnTo ?? cfg.dashboardUrl;
    return c.redirect(target, 302);
  });

  app.post('/logout', async (c) => {
    // Plain cookie read — same rationale as the session cookie in
    // `requireAdminSession`. We could also accept a bearer header
    // here to log out a CLI-issued token, but the SPA only sends
    // cookies, so this is the browser-only path.
    const token = getCookie(c, cfg.cookieName);
    if (token) {
      const hash = hashSessionToken(token);
      await db.delete(schema.adminSessions).where(eq(schema.adminSessions.tokenHash, hash));
    }
    deleteCookie(c, cfg.cookieName, {
      path: '/',
      secure: cfg.secureCookies,
    });

    // Optional provider-level logout. Returned in the response so the
    // SPA can redirect if desired — we don't force a cross-site
    // navigation from a POST.
    const endSession = await cfg.oidc.endSessionUrl(null, cfg.dashboardUrl);
    return c.json({ ok: true, data: { endSessionUrl: endSession } });
  });

  return app;
}

/**
 * Clamps `returnTo` to paths under the dashboard origin. Protects
 * against open redirects: an attacker can't pass a full URL to a
 * phishing site via `?redirect_to=https://evil`.
 */
function sanitizeReturnTo(raw: string | null, dashboardUrl: string): string | null {
  if (!raw) return null;
  try {
    const target = new URL(raw, dashboardUrl);
    const base = new URL(dashboardUrl);
    if (target.origin !== base.origin) return null;
    return target.pathname + target.search + target.hash;
  } catch {
    return null;
  }
}
