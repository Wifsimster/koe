import type { MiddlewareHandler } from 'hono';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { db, dbAvailable, schema } from '../db';
import { getSecretStoreFromEnv } from '../lib/secretStore';
import { fail } from '../lib/response';
import { checkRequestOrigin } from '../lib/widgetOrigin';

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
 * configured (`checkRequestOrigin`). This is the real access check: the
 * CORS preflight cannot know the project, so a disallowed origin is
 * refused here, before any handler runs.
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
  const originCheck = checkRequestOrigin({
    allowedOrigins: project.allowedOrigins,
    origin,
    secFetchSite: c.req.header('Sec-Fetch-Site'),
  });
  if (!originCheck.ok) {
    return fail(c, 'origin_not_allowed', originCheck.message, 403);
  }

  // Decrypt at the boundary. Legacy rows stored plaintext (pre-KMS
  // rollout) go through the same call — `decrypt` detects the lack of
  // an envelope prefix and returns them unchanged.
  const identitySecret = getSecretStoreFromEnv().decrypt(project.identitySecret);

  c.set('project', {
    id: project.id,
    key: project.key,
    name: project.name,
    allowedOrigins: project.allowedOrigins,
    identitySecret,
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
          lt(
            schema.projects.lastPingAt,
            sql`now() - make_interval(secs => ${HEARTBEAT_THROTTLE_SECONDS})`,
          ),
        ),
      ),
    )
    .catch((err) => {
      // Heartbeat failure is never a request-blocker. Log and move on.
      console.warn('[koe/api] heartbeat stamp failed', err);
    });

  await next();
};
