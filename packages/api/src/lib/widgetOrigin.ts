export const WIDGET_ALLOWED_METHODS = ['GET', 'POST'] as const;

export const WIDGET_ALLOWED_HEADERS = [
  'content-type',
  'x-koe-project-key',
  'x-koe-user-hash',
  'x-koe-identity-token',
] as const;

const PREFLIGHT_MAX_AGE_SECONDS = 600;

export function isOriginAllowed(allowedOrigins: readonly string[], origin: string): boolean {
  if (allowedOrigins.length === 0) return true;
  return allowedOrigins.includes(origin);
}

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
