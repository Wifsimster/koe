import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { widgetRoutes } from './routes/widget';
import { healthRoutes } from './routes/health';
import { createAdminRoutes } from './routes/admin';
import { createAdminApiRoutes } from './routes/adminApi';
import { fail } from './lib/response';

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
//   - `oidc`        → not yet implemented; booting with this value
//     fails loudly so the deployment config doesn't drift.
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
  app.route(
    '/v1/admin',
    createAdminApiRoutes({ dashboardOrigin: process.env.ADMIN_DASHBOARD_ORIGIN }),
  );
} else if (adminAuthMode === 'oidc') {
  throw new Error(
    'ADMIN_AUTH_MODE=oidc is declared but not yet implemented. The OIDC provider ' +
      'integration ships in a follow-up MR. Unset the env to boot without the admin API.',
  );
} else if (adminAuthMode !== undefined) {
  throw new Error(`Unknown ADMIN_AUTH_MODE=${adminAuthMode}`);
}

// Admin dashboard SPA. Off by default so a fresh `docker compose up`
// never serves an unauthenticated surface on the public internet.
// Operators opt in with `ENABLE_DASHBOARD=true`, at which point the SPA
// is served — note that the admin API it calls is independently gated
// by `ADMIN_AUTH_MODE`, so the SPA alone cannot read data.
if ((process.env.ENABLE_DASHBOARD ?? 'false').toLowerCase() === 'true') {
  app.route('/admin', createAdminRoutes());
}

app.onError((err, c) => {
  console.error('[koe/api] unhandled error', err);
  return fail(c, 'internal_error', 'Unexpected server error', 500);
});

app.notFound((c) => fail(c, 'not_found', 'Route not found', 404));

export default app;
