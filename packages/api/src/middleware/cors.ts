import type { MiddlewareHandler } from 'hono';
import { eq } from 'drizzle-orm';
import { db, dbAvailable, schema } from '../db';

const CACHE_TTL_MS = 60_000;
const originCache = new Map<string, { origins: string[]; expires: number }>();

interface KnownOriginsCache {
  origins: Set<string>;
  hasPermissiveProject: boolean;
  expires: number;
}
let knownOriginsCache: KnownOriginsCache | null = null;

/** Clears the cache entry for a project — call this when origins are updated. */
export function invalidateOriginCache(projectKey: string): void {
  originCache.delete(projectKey);
  // Also drop the flattened preflight cache; the union changed.
  knownOriginsCache = null;
}

/**
 * Loads (and caches) the union of every project's `allowedOrigins`. Used
 * by the preflight path, where the request has no `X-Koe-Project-Key` to
 * resolve a specific project — we still need to answer "is this origin
 * plausibly legitimate?" without reflecting arbitrary Origin headers.
 *
 * If *any* project has an empty `allowedOrigins` (explicitly permissive),
 * we fall back to reflecting any origin on preflight — the actual request
 * is still gated by the per-project check below.
 */
async function getKnownOrigins(): Promise<KnownOriginsCache | null> {
  if (knownOriginsCache && knownOriginsCache.expires > Date.now()) {
    return knownOriginsCache;
  }
  if (!dbAvailable) return null;

  const rows = await db
    .select({ allowedOrigins: schema.projects.allowedOrigins })
    .from(schema.projects);

  const origins = new Set<string>();
  let hasPermissiveProject = false;
  for (const row of rows) {
    if (row.allowedOrigins.length === 0) {
      hasPermissiveProject = true;
      continue;
    }
    for (const origin of row.allowedOrigins) origins.add(origin);
  }

  knownOriginsCache = {
    origins,
    hasPermissiveProject,
    expires: Date.now() + CACHE_TTL_MS,
  };
  return knownOriginsCache;
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
 * - Preflight (OPTIONS) requests check the `Origin` against the union of
 *   every project's `allowedOrigins`. Browsers don't carry custom headers
 *   on preflight, so we can't resolve a specific project here — but we
 *   also don't want to reflect arbitrary origins (probing / enumeration).
 *   The per-project check on the actual request remains authoritative.
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
      const known = await getKnownOrigins();
      const allow = known && (known.hasPermissiveProject || known.origins.has(origin));
      if (allow) {
        c.header('Access-Control-Allow-Origin', origin);
        c.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
        c.header(
          'Access-Control-Allow-Headers',
          'Content-Type, X-Koe-Project-Key, X-Koe-User-Hash, X-Koe-Identity-Token',
        );
        c.header('Access-Control-Max-Age', '600');
        c.header('Vary', 'Origin');
      }
    }
    // Always 204 — omitting CORS headers is sufficient for the browser
    // to block the follow-up request, without leaking whether the origin
    // is unknown vs. the preflight was malformed.
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
