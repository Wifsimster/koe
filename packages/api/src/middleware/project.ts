import type { MiddlewareHandler } from 'hono';
import { eq } from 'drizzle-orm';
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
  await next();
};
