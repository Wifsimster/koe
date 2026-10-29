import type { MiddlewareHandler } from 'hono';
import { eq } from 'drizzle-orm';
import { db, dbAvailable, schema } from '../db';
import { isOriginAllowed, preflightHeaders } from '../lib/widgetOrigin';

const CACHE_TTL_MS = 60_000;
const originCache = new Map<string, { origins: string[]; expires: number }>();

export function invalidateOriginCache(projectKey: string): void {
  originCache.delete(projectKey);
  allOriginsCache = null;
}

let allOriginsCache: { origins: Set<string>; anyOrigin: boolean; expires: number } | null = null;

async function isOriginKnownToAnyProject(origin: string): Promise<boolean> {
  if (!allOriginsCache || allOriginsCache.expires <= Date.now()) {
    if (!dbAvailable) return false;
    const rows = await db
      .select({ allowedOrigins: schema.projects.allowedOrigins })
      .from(schema.projects);
    allOriginsCache = {
      origins: new Set(rows.flatMap((r) => r.allowedOrigins)),
      anyOrigin: rows.some((r) => r.allowedOrigins.length === 0),
      expires: Date.now() + CACHE_TTL_MS,
    };
  }
  return allOriginsCache.anyOrigin || allOriginsCache.origins.has(origin);
}

async function getCachedOrigins(projectKey: string): Promise<string[] | null> {
  const cached = originCache.get(projectKey);
  if (cached && cached.expires > Date.now()) return cached.origins;
  if (!dbAvailable) return null;

  const [row] = await db
    .select({ allowedOrigins: schema.projects.allowedOrigins })
    .from(schema.projects)
    .where(eq(schema.projects.key, projectKey));

  if (!row) {
    return null;
  }

  const entry = { origins: row.allowedOrigins, expires: Date.now() + CACHE_TTL_MS };
  originCache.set(projectKey, entry);
  return entry.origins;
}

export interface OriginLookup {
  projectOrigins(projectKey: string): Promise<string[] | null>;
  anyProjectAccepts(origin: string): Promise<boolean>;
}

export function createWidgetCors(lookup: OriginLookup): MiddlewareHandler {
  return async (c, next) => {
    const origin = c.req.header('Origin');
    c.header('Vary', 'Origin');

    if (c.req.method === 'OPTIONS') {
      const headers = preflightHeaders(
        origin,
        c.req.header('Access-Control-Request-Method'),
        c.req.header('Access-Control-Request-Headers'),
      );
      if (headers && origin && (await lookup.anyProjectAccepts(origin))) {
        for (const [k, v] of Object.entries(headers)) c.header(k, v);
      }
      return c.body(null, 204);
    }

    const projectKey = c.req.header('X-Koe-Project-Key');
    if (origin && projectKey) {
      const allowed = await lookup.projectOrigins(projectKey);
      if (allowed && isOriginAllowed(allowed, origin)) {
        c.header('Access-Control-Allow-Origin', origin);
      }
    }

    await next();
  };
}

export const widgetCors = createWidgetCors({
  projectOrigins: getCachedOrigins,
  anyProjectAccepts: isOriginKnownToAnyProject,
});
