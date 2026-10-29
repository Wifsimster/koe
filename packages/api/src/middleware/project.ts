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

const HEARTBEAT_THROTTLE_SECONDS = 60;

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

  const identitySecret = getSecretStoreFromEnv().decrypt(project.identitySecret);

  c.set('project', {
    id: project.id,
    key: project.key,
    name: project.name,
    allowedOrigins: project.allowedOrigins,
    identitySecret,
    requireIdentityVerification: project.requireIdentityVerification,
  });

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
      console.warn('[koe/api] heartbeat stamp failed', err);
    });

  await next();
};
