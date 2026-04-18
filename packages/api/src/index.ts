import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { widgetRoutes } from './routes/widget';
import { healthRoutes } from './routes/health';
import { createAdminRoutes } from './routes/admin';
import { createAdminApiRoutes } from './routes/adminApi';
import { createAuthRoutes } from './routes/passwordAuth';
import { requireSameOrigin } from './middleware/adminAuth';
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
//
// Sentinel detection: fail loud when env files ship through unchanged.
// `REPLACE_ME…` lands as-is for operators who skim the example file;
// argon2 verify would then silently reject every login, which is
// confusing. Refusing to boot surfaces the real problem immediately.
const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH;
const adminSessionSecret = process.env.ADMIN_SESSION_SECRET;
if (adminPasswordHash?.startsWith('REPLACE_ME')) {
  throw new Error(
    'ADMIN_PASSWORD_HASH still contains the placeholder value. Generate a real ' +
      "hash with `docker compose run --rm api hash-password` and paste it into .env.",
  );
}
if (adminSessionSecret?.startsWith('REPLACE_ME')) {
  throw new Error(
    'ADMIN_SESSION_SECRET still contains the placeholder value. Generate one ' +
      'with `openssl rand -hex 32` and paste it into .env.',
  );
}

const adminConfigured =
  !!process.env.ADMIN_EMAIL && !!adminPasswordHash && !!adminSessionSecret;

if (adminConfigured) {
  const authRoutes = createAuthRoutes({
    sessionTtlDays: Number(process.env.ADMIN_SESSION_TTL_DAYS ?? '7'),
    secureCookies:
      (process.env.ADMIN_COOKIES_SECURE ?? 'true').toLowerCase() !== 'false',
  });

  const adminRoot = new Hono();
  // CSRF defence runs before everything else in the admin namespace so
  // login/logout (which mutate) are protected too, not only the
  // session-gated API routes.
  adminRoot.use('*', requireSameOrigin);
  // `/auth/*` mounts first so /auth/login and /auth/logout aren't
  // swallowed by the session-gated API routes.
  adminRoot.route('/auth', authRoutes);
  adminRoot.route('/', createAdminApiRoutes());

  app.route('/v1/admin', adminRoot);
} else if (process.env.ADMIN_EMAIL || adminPasswordHash) {
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
