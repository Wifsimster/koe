import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { ok, fail } from '../lib/response';
import { db, dbAvailable } from '../db';

export const healthRoutes = new Hono();

healthRoutes.get('/', (c) => ok(c, { status: 'ok', service: 'koe-server' }));

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
