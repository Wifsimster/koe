import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { widgetRoutes } from './routes/widget';
import { healthRoutes } from './routes/health';
import { createAdminRoutes } from './routes/admin';
import { fail } from './lib/response';

export const app = new Hono();

app.use('*', logger());

// CORS is applied per-route group. The widget API has its own dynamic,
// per-project allowlist (see `middleware/cors.ts`); the admin API (once
// wired) will use a static env-driven allowlist for the dashboard origin.
app.route('/health', healthRoutes);
app.route('/v1/widget', widgetRoutes);

// Optional admin dashboard. Opt-in because the dashboard is still a
// placeholder and has no auth — don't expose it by accident.
if ((process.env.ENABLE_DASHBOARD ?? 'false').toLowerCase() === 'true') {
  app.route('/admin', createAdminRoutes());
}

app.onError((err, c) => {
  console.error('[koe/api] unhandled error', err);
  return fail(c, 'internal_error', 'Unexpected server error', 500);
});

app.notFound((c) => fail(c, 'not_found', 'Route not found', 404));

export default app;
