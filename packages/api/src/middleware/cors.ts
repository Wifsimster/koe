import type { MiddlewareHandler } from 'hono';
import { eq } from 'drizzle-orm';
import { db, dbAvailable, schema } from '../db';
import { isOriginAllowed, preflightHeaders } from '../lib/widgetOrigin';

/**
 * Per-entry TTL fallback. If the route layer forgets to call
 * `invalidateOriginCache(projectKey)` after a project mutation, stale
 * data can only persist this long before being refreshed from the DB.
 * Belt-and-suspenders: invalidation is the primary path, TTL is the
 * safety net.
 */
const CACHE_TTL_MS = 60_000;
const originCache = new Map<string, { origins: string[]; expires: number }>();

/**
 * Clears the cache entry for a project — call this whenever a project
 * row's `allowedOrigins` (or the project itself) is mutated. Routes
 * call this directly; we expose a stable signature so the route side
 * doesn't have to know about the cache shape.
 */
export function invalidateOriginCache(projectKey: string): void {
  originCache.delete(projectKey);
  allOriginsCache = null;
}

/**
 * Every project's allowlist, for the preflight. `anyOrigin` is true when at
 * least one project accepts any origin (empty allowlist). Cached for the
 * same TTL, misses included: a preflight carries no project key, so an
 * uncached miss would cost one DB read per preflight from any origin.
 */
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
    // Negative result is intentionally NOT cached — we don't want a
    // race where the project is created milliseconds later but its
    // CORS path still 403s for a full TTL window.
    return null;
  }

  const entry = { origins: row.allowedOrigins, expires: Date.now() + CACHE_TTL_MS };
  originCache.set(projectKey, entry);
  return entry.origins;
}

export interface OriginLookup {
  /** The project's `allowedOrigins`, or `null` for an unknown key. */
  projectOrigins(projectKey: string): Promise<string[] | null>;
  /** Whether at least one project accepts this origin. */
  anyProjectAccepts(origin: string): Promise<boolean>;
}

/**
 * CORS for the embeddable widget.
 *
 * Every host SaaS app that embeds the widget is a potential origin, so there
 * is no static allowlist. The rules live in `lib/widgetOrigin.ts`:
 *
 * - Preflight (`OPTIONS`): browsers never send the `X-Koe-Project-Key`
 *   value on a preflight, so the project is unknown here. The preflight is
 *   answered from the `Origin` and the requested method and headers
 *   (`preflightHeaders`), and only for an origin that at least one project
 *   accepts. It grants no access by itself.
 * - Real request: `Access-Control-Allow-Origin` is reflected only when this
 *   project's `allowedOrigins` accepts the origin. `requireProject` then
 *   refuses a disallowed origin with a 403 before any handler runs, so a
 *   preflight that passed thanks to another project cannot lead to a write.
 *
 * We always reflect the specific origin, never `*`, and never set
 * `Access-Control-Allow-Credentials`: the widget sends no cookies.
 */
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
      // Always 204: a missing CORS header is enough for the browser to block
      // the real request.
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
