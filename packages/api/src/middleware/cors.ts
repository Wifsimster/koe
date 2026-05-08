import type { MiddlewareHandler } from 'hono';
import { eq } from 'drizzle-orm';
import { db, dbAvailable, schema } from '../db';

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

/**
 * Decides whether `origin` is allowed for the given project's
 * `allowedOrigins`. An empty list keeps the historical permissive
 * semantic: the project's owner has explicitly opted in to "any
 * origin". Important: this permissiveness is per-project, never
 * leaked to other projects.
 */
function isOriginAllowed(allowedOrigins: string[], origin: string): boolean {
  if (allowedOrigins.length === 0) return true;
  return allowedOrigins.includes(origin);
}

/**
 * CORS for the embeddable widget.
 *
 * Unlike a typical API we cannot keep a static allowlist — every host SaaS
 * app that embeds the widget is a valid origin. Instead we enforce the
 * per-project `allowedOrigins` at the CORS layer AND again in
 * `requireProject` (defense in depth).
 *
 * Project resolution
 * ------------------
 * We resolve the requesting project from `X-Koe-Project-Key` on every
 * request — preflight included. Earlier versions cached a global union
 * of every project's `allowedOrigins` on the preflight path; that
 * leaked permissiveness across tenants (one project with an empty
 * allowlist made every other project's preflight reflect arbitrary
 * origins). The per-project lookup eliminates that leak: a strict
 * project's preflight cannot succeed via a permissive sibling.
 *
 * If the project key is missing (browser-driven preflights don't send
 * custom headers) or unknown, we default to strict deny — emit no CORS
 * headers and 204. The browser blocks the follow-up request without
 * us having to leak whether the project exists. Widget integrations
 * that need cross-origin browser preflight must keep `allowedOrigins`
 * explicit per project.
 *
 * Credentials
 * -----------
 * We never set `Access-Control-Allow-Credentials: true`. The widget
 * does not need cookies to operate, and combining
 * `Access-Control-Allow-Credentials: true` with `Allow-Origin: *` is
 * rejected by browsers anyway — so even on the permissive (empty
 * allowlist) path we always reflect the specific `Origin`, never `*`.
 */
export const widgetCors: MiddlewareHandler = async (c, next) => {
  const origin = c.req.header('Origin');
  const projectKey = c.req.header('X-Koe-Project-Key');

  if (c.req.method === 'OPTIONS') {
    if (origin && projectKey) {
      const allowed = await getCachedOrigins(projectKey);
      if (allowed && isOriginAllowed(allowed, origin)) {
        // Reflect the specific Origin — never `*`. Even when the
        // project is permissive (empty allowlist), echoing `*` would
        // both leak permissiveness across tenants in the response
        // and be incompatible with any future credentialed request.
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
    // to block the follow-up request, without leaking whether the
    // origin/project is unknown vs. the preflight was malformed.
    return c.body(null, 204);
  }

  if (origin && projectKey) {
    const allowed = await getCachedOrigins(projectKey);
    if (allowed && isOriginAllowed(allowed, origin)) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Vary', 'Origin');
    }
  }

  await next();
};
