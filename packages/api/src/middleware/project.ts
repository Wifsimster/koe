import type { MiddlewareHandler } from 'hono';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { db, dbAvailable, schema } from '../db';
import { fail } from '../lib/response';

export interface ProjectContext {
  project: {
    id: string;
    key: string;
    name: string;
    allowedOrigins: string[];
    identitySecret: string;
    requireIdentityVerification: boolean;
  };
}

/**
 * Heartbeat throttle. Writing `last_ping_at` on every widget request
 * is wasteful under any real traffic — one UPDATE per request —
 * and the dashboard only cares whether the widget has been heard
 * from "recently". 60 seconds of staleness is indistinguishable from
 * live to the operator reading an empty state.
 */
const HEARTBEAT_THROTTLE_SECONDS = 60;

/**
 * Resolves `X-Koe-Project-Key` to a project row and attaches it to the
 * Hono context. Also enforces the origin allowlist when one is
 * configured — this is defense in depth on top of the CORS layer, and
 * catches non-browser clients that don't send an `Origin` header when
 * the project requires one.
 */
export const requireProject: MiddlewareHandler<{ Variables: ProjectContext }> = async (c, next) => {
  const key = c.req.header('X-Koe-Project-Key');
  if (!key) {
    return fail(c, 'invalid_project_key', 'Missing X-Koe-Project-Key header', 401);
  }
  if (!dbAvailable) {
    return fail(c, 'internal_error', 'Database is not configured', 500);
  }

  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.key, key));
  if (!project) {
    return fail(c, 'invalid_project_key', 'Unknown project key', 401);
  }

  const origin = c.req.header('Origin');
  if (project.allowedOrigins.length > 0) {
    // A project with an explicit allowlist never accepts blank Origin
    // requests — those bypass browser CORS entirely.
    if (!origin) {
      return fail(c, 'origin_not_allowed', 'Origin header is required', 403);
    }
    if (!project.allowedOrigins.includes(origin)) {
      return fail(c, 'origin_not_allowed', `Origin ${origin} is not allowed`, 403);
    }
  }

  c.set('project', {
    id: project.id,
    key: project.key,
    name: project.name,
    allowedOrigins: project.allowedOrigins,
    identitySecret: project.identitySecret,
    requireIdentityVerification: project.requireIdentityVerification,
  });

  // Heartbeat stamp. Conditional WHERE collapses the read-then-write
  // race into a single round-trip: the update only fires when the
  // previous stamp is older than the throttle (or null). Safe to
  // fire-and-forget — heartbeat is observational, not on the hot path.
  void db
    .update(schema.projects)
    .set({
      lastPingAt: new Date(),
      lastPingOrigin: origin ?? null,
    })
    .where(
      and(
        eq(schema.projects.id, project.id),
        or(
          isNull(schema.projects.lastPingAt),
          lt(schema.projects.lastPingAt, sql`now() - make_interval(secs => ${HEARTBEAT_THROTTLE_SECONDS})`),
        ),
      ),
    )
    .catch((err) => {
      // Heartbeat failure is never a request-blocker. Log and move on.
      console.warn('[koe/api] heartbeat stamp failed', err);
    });

  await next();
};
