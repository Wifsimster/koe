import type { MiddlewareHandler } from 'hono';
import { eq } from 'drizzle-orm';
import { db, dbAvailable, schema } from '../db';

const CACHE_TTL_MS = 60_000;
const originCache = new Map<string, { origins: string[]; expires: number }>();

/** Clears the cache entry for a project — call this when origins are updated. */
export function invalidateOriginCache(projectKey: string): void {
  originCache.delete(projectKey);
}

async function getCachedOrigins(projectKey: string): Promise<string[] | null> {
  const cached = originCache.get(projectKey);
  if (cached && cached.expires > Date.now()) return cached.origins;
  if (!dbAvailable) return null;

  const [row] = await db
    .select({ allowedOrigins: schema.projects.allowedOrigins })
    .from(schema.projects)
    .where(eq(schema.projects.key, projectKey));

  if (!row) return null;

  const entry = { origins: row.allowedOrigins, expires: Date.now() + CACHE_TTL_MS };
  originCache.set(projectKey, entry);
  return entry.origins;
}

/**
 * CORS for the embeddable widget.
 *
 * Unlike a typical API we cannot keep a static allowlist — every host SaaS
 * app that embeds the widget is a valid origin. Instead we enforce the
 * per-project `allowedOrigins` at the CORS layer AND again in
 * `requireProject` (defense in depth).
 *
 * - Preflight (OPTIONS) requests are answered optimistically with the
 *   requesting origin. Browsers don't carry custom headers on preflight,
 *   so we can't resolve the project at that stage. The actual request is
 *   where we enforce.
 * - Actual requests only get `Access-Control-Allow-Origin` back when the
 *   origin is listed on the project (or the project's list is empty,
 *   i.e. explicitly permissive).
 * - We never set `Access-Control-Allow-Credentials: true`. The widget
 *   does not need cookies to operate; turning it on re-opens the hole.
 */
export const widgetCors: MiddlewareHandler = async (c, next) => {
  const origin = c.req.header('Origin');

  if (c.req.method === 'OPTIONS') {
    if (origin) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      c.header(
        'Access-Control-Allow-Headers',
        'Content-Type, X-Koe-Project-Key, X-Koe-User-Hash',
      );
      c.header('Access-Control-Max-Age', '600');
      c.header('Vary', 'Origin');
    }
    return c.body(null, 204);
  }

  if (origin) {
    const key = c.req.header('X-Koe-Project-Key');
    if (key) {
      const allowed = await getCachedOrigins(key);
      if (allowed && (allowed.length === 0 || allowed.includes(origin))) {
        c.header('Access-Control-Allow-Origin', origin);
        c.header('Vary', 'Origin');
      }
    }
  }

  await next();
};
