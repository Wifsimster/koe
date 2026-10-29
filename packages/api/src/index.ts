import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { widgetRoutes } from './routes/widget';
import { publicRoadmapRoutes } from './routes/public';
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

app.route('/', publicRoadmapRoutes);

const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH;
const adminSessionSecret = process.env.ADMIN_SESSION_SECRET;
if (adminPasswordHash?.startsWith('REPLACE_ME')) {
  throw new Error(
    'ADMIN_PASSWORD_HASH still contains the placeholder value. Generate a real ' +
      'hash with `docker compose run --rm api hash-password` and paste it into .env.',
  );
}
if (adminSessionSecret?.startsWith('REPLACE_ME')) {
  throw new Error(
    'ADMIN_SESSION_SECRET still contains the placeholder value. Generate one ' +
      'with `openssl rand -hex 32` and paste it into .env.',
  );
}

const adminConfigured = !!process.env.ADMIN_EMAIL && !!adminPasswordHash && !!adminSessionSecret;

const DEFAULT_SESSION_TTL_DAYS = 7;
function resolveSessionTtlDays(): number {
  const raw = process.env.ADMIN_SESSION_TTL_DAYS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_SESSION_TTL_DAYS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(
      `[koe/api] invalid ADMIN_SESSION_TTL_DAYS="${raw}", falling back to ${DEFAULT_SESSION_TTL_DAYS}`,
    );
    return DEFAULT_SESSION_TTL_DAYS;
  }
  return parsed;
}

if (adminConfigured) {
  const authRoutes = createAuthRoutes({
    sessionTtlDays: resolveSessionTtlDays(),
    secureCookies: (process.env.ADMIN_COOKIES_SECURE ?? 'true').toLowerCase() !== 'false',
  });

  const adminRoot = new Hono();
  adminRoot.use('*', requireSameOrigin);
  adminRoot.route('/auth', authRoutes);
  adminRoot.route('/', createAdminApiRoutes());

  app.route('/v1/admin', adminRoot);
} else if (process.env.ADMIN_EMAIL || adminPasswordHash) {
  throw new Error(
    'Admin auth requires all of ADMIN_EMAIL, ADMIN_PASSWORD_HASH, and ' +
      'ADMIN_SESSION_SECRET. See packages/api/.env.example.',
  );
}

if ((process.env.ENABLE_DASHBOARD ?? 'true').toLowerCase() === 'true') {
  app.route('/admin', createAdminRoutes());
}

app.onError((err, c) => {
  console.error('[koe/api] unhandled error', err);
  return fail(c, 'internal_error', 'Unexpected server error', 500);
});

app.notFound((c) => fail(c, 'not_found', 'Route not found', 404));

export default app;
