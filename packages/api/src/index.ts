import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { widgetRoutes } from './routes/widget';
import { healthRoutes } from './routes/health';
import { createAdminRoutes } from './routes/admin';
import { createAdminApiRoutes } from './routes/adminApi';
import { createOidcAuthRoutes } from './routes/oidcAuth';
import { createPasswordAuthRoutes } from './routes/passwordAuth';
import { createOidcService } from './lib/oidc';
import { ok, fail } from './lib/response';

export const app = new Hono();

app.use('*', logger());

// CORS is applied per-route group. The widget API has its own dynamic,
// per-project allowlist (see `middleware/cors.ts`); the admin API uses
// a static env-driven single-origin allowlist (see below).
app.route('/health', healthRoutes);
app.route('/v1/widget', widgetRoutes);

// Admin JSON API. Gated by `ADMIN_AUTH_MODE`:
//   - `dev-session` → bearer-token session auth. Operators mint tokens
//     with the `admin-session` CLI. Acceptable for local and staging;
//     refused in production to prevent accidental exposure.
//   - `password`    → email + password login against argon2id hashes in
//     `admin_users.password_hash`. Users are seeded by the `admin-user`
//     CLI. Uses the same session cookie + `admin_sessions` row as OIDC.
//   - `oidc`        → provider-agnostic OIDC login via `openid-client`.
//     Sets a same-origin session cookie on callback; the existing
//     `admin_sessions` table stores only the SHA-256 hash.
//   - unset         → admin API is not mounted. This is the intentional
//     safe default so a fresh deploy never exposes an unauthenticated
//     admin surface.
const adminAuthMode = process.env.ADMIN_AUTH_MODE;
if (adminAuthMode === 'dev-session') {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'ADMIN_AUTH_MODE=dev-session is not allowed in production. Set ADMIN_AUTH_MODE=oidc ' +
        'once an OIDC provider is configured.',
    );
  }
  // Expose the same `/auth/config` discovery endpoint as the other
  // modes so the SPA can resolve its login form at runtime. No other
  // `/auth/*` routes here — the CLI flow is out-of-band.
  const adminRoot = new Hono();
  const devAuth = new Hono();
  devAuth.get('/config', (c) => ok(c, { mode: 'dev-session' as const }));
  adminRoot.route('/auth', devAuth);
  adminRoot.route(
    '/',
    createAdminApiRoutes({ dashboardOrigin: process.env.ADMIN_DASHBOARD_ORIGIN }),
  );
  app.route('/v1/admin', adminRoot);
} else if (adminAuthMode === 'oidc') {
  const {
    OIDC_ISSUER_URL,
    OIDC_CLIENT_ID,
    OIDC_CLIENT_SECRET,
    OIDC_REDIRECT_URI,
    OIDC_SCOPES,
    OIDC_DASHBOARD_URL,
    OIDC_COOKIE_SECRET,
    ADMIN_SESSION_COOKIE,
    ADMIN_SESSION_TTL_DAYS,
    ADMIN_COOKIES_SECURE,
  } = process.env;

  for (const [name, value] of Object.entries({
    OIDC_ISSUER_URL,
    OIDC_CLIENT_ID,
    OIDC_CLIENT_SECRET,
    OIDC_REDIRECT_URI,
    OIDC_DASHBOARD_URL,
    OIDC_COOKIE_SECRET,
  })) {
    if (!value) {
      throw new Error(
        `ADMIN_AUTH_MODE=oidc requires ${name} to be set. See packages/api/.env.example.`,
      );
    }
  }

  const oidc = createOidcService({
    issuerUrl: OIDC_ISSUER_URL!,
    clientId: OIDC_CLIENT_ID!,
    clientSecret: OIDC_CLIENT_SECRET!,
    redirectUri: OIDC_REDIRECT_URI!,
    scopes: OIDC_SCOPES,
  });

  // Two sibling mounts under `/v1/admin`: the OIDC dance on
  // `/auth/*` (public, no session required) and the JSON API on
  // everything else (session-gated). Order matters — `/auth/*` must
  // mount first so its handlers win before the catch-all session
  // guard inside `createAdminApiRoutes`.
  const adminRoot = new Hono();
  adminRoot.route(
    '/auth',
    createOidcAuthRoutes({
      oidc,
      dashboardUrl: OIDC_DASHBOARD_URL!,
      cookieName: ADMIN_SESSION_COOKIE ?? 'koe_admin',
      sessionTtlDays: Number(ADMIN_SESSION_TTL_DAYS ?? '30'),
      cookieSecret: OIDC_COOKIE_SECRET!,
      secureCookies: (ADMIN_COOKIES_SECURE ?? 'true').toLowerCase() !== 'false',
    }),
  );
  adminRoot.route(
    '/',
    createAdminApiRoutes({ dashboardOrigin: process.env.ADMIN_DASHBOARD_ORIGIN }),
  );

  app.route('/v1/admin', adminRoot);
} else if (adminAuthMode === 'password') {
  const passwordAuth = createPasswordAuthRoutes({
    cookieName: process.env.ADMIN_SESSION_COOKIE ?? 'koe_admin',
    sessionTtlDays: Number(process.env.ADMIN_SESSION_TTL_DAYS ?? '30'),
    secureCookies:
      (process.env.ADMIN_COOKIES_SECURE ?? 'true').toLowerCase() !== 'false',
  });

  const adminRoot = new Hono();
  // `/auth/*` mounts first so `/auth/password` and `/auth/logout`
  // aren't swallowed by the session-gated API routes.
  adminRoot.route('/auth', passwordAuth);
  adminRoot.route(
    '/',
    createAdminApiRoutes({ dashboardOrigin: process.env.ADMIN_DASHBOARD_ORIGIN }),
  );

  app.route('/v1/admin', adminRoot);
} else if (adminAuthMode !== undefined) {
  throw new Error(`Unknown ADMIN_AUTH_MODE=${adminAuthMode}`);
}

// Admin dashboard SPA. Opt-in via `ENABLE_DASHBOARD=true`: until the
// dashboard has its own auth wired (better-auth lands in a follow-up
// MR), serving the UI by default on a self-hosted image would leak an
// unauthenticated admin surface to any operator who exposes port 8787
// without a reverse proxy. Operators who want the UI must consciously
// flip the flag and accept responsibility for putting auth in front of
// `/admin/*`.
if ((process.env.ENABLE_DASHBOARD ?? 'false').toLowerCase() === 'true') {
  app.route('/admin', createAdminRoutes());
}

app.onError((err, c) => {
  console.error('[koe/api] unhandled error', err);
  return fail(c, 'internal_error', 'Unexpected server error', 500);
});

app.notFound((c) => fail(c, 'not_found', 'Route not found', 404));

export default app;
