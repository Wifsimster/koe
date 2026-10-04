/**
 * Origin rules for the public widget API, kept free of Hono and the DB so
 * they can be unit-tested. `middleware/cors.ts` and `middleware/project.ts`
 * apply them.
 *
 * The split that matters:
 * - A CORS preflight (`OPTIONS`) carries no `X-Koe-Project-Key` value:
 *   browsers never send custom header values on a preflight. The preflight
 *   is therefore answered from the `Origin` and the requested method and
 *   headers only. It grants nothing by itself: it lets the browser send the
 *   real request, nothing more.
 * - The real request carries the project key. `requireProject` checks the
 *   project's `allowedOrigins` there, before any handler runs, and
 *   `widgetCors` reflects `Access-Control-Allow-Origin` only for an allowed
 *   origin. A disallowed origin gets a 403 without CORS headers, so the
 *   browser also hides the response from the calling page.
 */

export const WIDGET_ALLOWED_METHODS = ['GET', 'POST'] as const;

/** Lower-case, as browsers send them in `Access-Control-Request-Headers`. */
export const WIDGET_ALLOWED_HEADERS = [
  'content-type',
  'x-koe-project-key',
  'x-koe-user-hash',
  'x-koe-identity-token',
] as const;

const PREFLIGHT_MAX_AGE_SECONDS = 600;

/**
 * An empty list is the project's explicit "any origin" opt-in. It never
 * applies to another project.
 */
export function isOriginAllowed(allowedOrigins: readonly string[], origin: string): boolean {
  if (allowedOrigins.length === 0) return true;
  return allowedOrigins.includes(origin);
}

/**
 * Headers for a CORS preflight answer, or `null` to answer without CORS
 * headers (the browser then blocks the real request).
 *
 * Refuses a missing or opaque (`null`) origin, a method the widget API does
 * not serve, and any requested header outside the widget's own set. Always
 * reflects the specific origin, never `*`, and never sets
 * `Access-Control-Allow-Credentials`: the widget sends no cookies.
 */
export function preflightHeaders(
  origin: string | undefined,
  requestMethod: string | undefined,
  requestHeaders: string | undefined,
): Record<string, string> | null {
  if (!origin || origin === 'null') return null;
  const method = requestMethod?.trim().toUpperCase();
  if (!method || !(WIDGET_ALLOWED_METHODS as readonly string[]).includes(method)) return null;
  const requested = (requestHeaders ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (requested.some((h) => !(WIDGET_ALLOWED_HEADERS as readonly string[]).includes(h))) {
    return null;
  }
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': WIDGET_ALLOWED_METHODS.join(', '),
    'Access-Control-Allow-Headers': WIDGET_ALLOWED_HEADERS.join(', '),
    'Access-Control-Max-Age': String(PREFLIGHT_MAX_AGE_SECONDS),
  };
}

export type OriginCheck = { ok: true } | { ok: false; message: string };

/**
 * The per-project origin check on a real (non-preflight) widget request.
 *
 * Browsers omit `Origin` on same-origin GETs (a host that serves the widget
 * API under its own domain). They always send `Sec-Fetch-Site`, a header
 * page scripts cannot set, so `same-origin` without `Origin` is accepted.
 * A request with neither header (curl, server-side scripts, old browsers)
 * is refused when the project has an allowlist.
 */
export function checkRequestOrigin(input: {
  allowedOrigins: readonly string[];
  origin: string | undefined;
  secFetchSite: string | undefined;
}): OriginCheck {
  const { allowedOrigins, origin, secFetchSite } = input;
  if (allowedOrigins.length === 0) return { ok: true };
  if (!origin) {
    if (secFetchSite === 'same-origin') return { ok: true };
    return { ok: false, message: 'Origin header is required' };
  }
  if (!allowedOrigins.includes(origin)) {
    return { ok: false, message: `Origin ${origin} is not allowed` };
  }
  return { ok: true };
}
