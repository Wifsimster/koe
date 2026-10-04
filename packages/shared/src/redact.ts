/**
 * Privacy redaction for captured report context. The widget applies it
 * before sending, and the API applies it again before storing, so a
 * report never carries query values, tokens or e-mail addresses that the
 * reporter did not type into the form themselves.
 */

/** Opaque values: long base64/hex-ish runs. UUIDs are kept (they identify records, a replay needs them). */
const TOKEN_RE = /^[A-Za-z0-9_\-.~+/=]{32,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SENSITIVE_NAME_RE =
  /(token|secret|passw|pwd|api[_-]?key|auth|session|sig|signature|code|credential|jwt|email)/i;

export const REDACTED = '[redacted]';

function isTokenLike(value: string): boolean {
  return TOKEN_RE.test(value) && !UUID_RE.test(value) && /\d/.test(value) && /[A-Za-z]/.test(value);
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function redactParams(params: URLSearchParams, keep: readonly string[]): string {
  const parts: string[] = [];
  params.forEach((value, name) => {
    const kept = keep.includes(name) && !SENSITIVE_NAME_RE.test(name) && !isTokenLike(value);
    parts.push(`${encodeURIComponent(name)}=${kept ? encodeURIComponent(value) : ''}`);
  });
  return parts.join('&');
}

export interface RedactUrlOptions {
  /** Query parameter names whose values are kept (never for sensitive names or token-like values). */
  keepQueryParams?: readonly string[];
}

/**
 * Keeps the origin, the path and the query parameter names. Drops every
 * query value (except `keepQueryParams`), credentials, token-like path
 * segments, and hash values (`#access_token=...`). A plain `#section`
 * anchor is kept.
 */
export function redactUrl(input: string, options: RedactUrlOptions = {}): string {
  if (!input) return input;
  const keep = options.keepQueryParams ?? [];
  let url: URL;
  const relative = !/^[a-z][a-z0-9+.-]*:/i.test(input);
  try {
    url = new URL(input, 'http://relative.invalid');
  } catch {
    return REDACTED;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return `${url.protocol}${REDACTED}`;
  }
  const path = url.pathname
    .split('/')
    .map((seg) => (isTokenLike(safeDecode(seg)) ? REDACTED : seg))
    .join('/');
  const query = url.search ? `?${redactParams(url.searchParams, keep)}` : '';
  let hash = '';
  if (url.hash) {
    const raw = url.hash.slice(1);
    hash = raw.includes('=')
      ? `#${redactParams(new URLSearchParams(raw), [])}`
      : isTokenLike(raw)
        ? `#${REDACTED}`
        : url.hash;
  }
  return `${relative ? '' : url.origin}${path}${query}${hash}`;
}

const URL_IN_TEXT_RE = /\bhttps?:\/\/[^\s"'<>)]+/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;
const BEARER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9_\-.~+/=]+/gi;
const KEY_VALUE_RE =
  /\b([\w-]*(?:token|secret|passw|pwd|api[_-]?key|session|signature|credential)[\w-]*)(["']?\s*[=:]\s*["']?)[^\s"'&,;]+/gi;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const LONG_TOKEN_RE = /[A-Za-z0-9_\-+/=]{32,}/g;

/**
 * Redacts free text (console messages): URLs go through `redactUrl`, then
 * JWTs, bearer credentials, `token=...`-style pairs, e-mail addresses and
 * long opaque strings are replaced. The result is truncated to `max`.
 */
export function redactText(input: string, max = 500): string {
  const out = String(input)
    .replace(URL_IN_TEXT_RE, (u) => redactUrl(u))
    .replace(JWT_RE, REDACTED)
    .replace(BEARER_RE, (_m, scheme: string) => `${scheme} ${REDACTED}`)
    .replace(KEY_VALUE_RE, (_m, key: string, sep: string) => `${key}${sep}${REDACTED}`)
    .replace(EMAIL_RE, '[email]')
    .replace(LONG_TOKEN_RE, (t) => (isTokenLike(t) ? REDACTED : t));
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}
