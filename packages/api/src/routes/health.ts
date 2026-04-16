import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { ok, fail } from '../lib/response';
import { db, dbAvailable } from '../db';

export const healthRoutes = new Hono();

// Liveness: the process is up. Used by container orchestrators to decide
// whether to restart the pod. Must never touch the DB.
healthRoutes.get('/', (c) => ok(c, { status: 'ok', service: 'koe-api' }));

// Readiness: the process can serve traffic. Used by compose / k8s / LB
// healthchecks to gate traffic until the DB is reachable and migrations
// have run.
healthRoutes.get('/ready', async (c) => {
  if (!dbAvailable) {
    return fail(c, 'internal_error', 'DATABASE_URL is not configured', 503);
  }
  try {
    await db.execute(sql`select 1`);
    return ok(c, { status: 'ready' });
  } catch (err) {
    console.error('[koe/api] readiness probe failed', err);
    return fail(c, 'internal_error', 'Database is unreachable', 503);
  }
});
