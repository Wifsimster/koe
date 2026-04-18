import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { widgetRoutes } from './routes/widget';
import { healthRoutes } from './routes/health';
import { createAdminRoutes } from './routes/admin';
import { createAdminApiRoutes } from './routes/adminApi';
import { createAuthRoutes } from './routes/passwordAuth';
import { fail } from './lib/response';

export const app = new Hono();

app.use('*', logger());

app.route('/health', healthRoutes);
app.route('/v1/widget', widgetRoutes);

// Admin JSON API. Single-admin product — credentials live in env vars
// (ADMIN_EMAIL + ADMIN_PASSWORD_HASH) and the session is a signed
// cookie (ADMIN_SESSION_SECRET). The admin surface is mounted whenever
// those three vars are set; otherwise it stays off so a fresh deploy
// never exposes an unauthenticated admin API.
const adminConfigured =
  !!process.env.ADMIN_EMAIL &&
  !!process.env.ADMIN_PASSWORD_HASH &&
  !!process.env.ADMIN_SESSION_SECRET;

if (adminConfigured) {
  const authRoutes = createAuthRoutes({
    sessionTtlDays: Number(process.env.ADMIN_SESSION_TTL_DAYS ?? '30'),
    secureCookies:
      (process.env.ADMIN_COOKIES_SECURE ?? 'true').toLowerCase() !== 'false',
  });

  const adminRoot = new Hono();
  // `/auth/*` mounts first so /auth/login and /auth/logout aren't
  // swallowed by the session-gated API routes.
  adminRoot.route('/auth', authRoutes);
  adminRoot.route('/', createAdminApiRoutes());

  app.route('/v1/admin', adminRoot);
} else if (process.env.ADMIN_EMAIL || process.env.ADMIN_PASSWORD_HASH) {
  // Partial config = configuration error, not "no admin". Fail loud
  // so the operator notices before they assume the surface is up.
  throw new Error(
    'Admin auth requires all of ADMIN_EMAIL, ADMIN_PASSWORD_HASH, and ' +
      'ADMIN_SESSION_SECRET. See packages/api/.env.example.',
  );
}

// Admin dashboard SPA. Off by default — flip ENABLE_DASHBOARD=true to
// serve the UI at `/admin/*`. The static assets are public; the
// admin API behind them requires the session cookie, so a flipped
// flag without ADMIN_* vars set just shows a non-functional shell.
if ((process.env.ENABLE_DASHBOARD ?? 'true').toLowerCase() === 'true') {
  app.route('/admin', createAdminRoutes());
}

app.onError((err, c) => {
  console.error('[koe/api] unhandled error', err);
  return fail(c, 'internal_error', 'Unexpected server error', 500);
});

app.notFound((c) => fail(c, 'not_found', 'Route not found', 404));

export default app;
