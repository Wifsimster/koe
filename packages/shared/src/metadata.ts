import type { BrowserMetadata } from './types/ticket';

/**
 * Captures browser/environment data to attach to a bug report. Safe to call
 * in any browser; falls back to empty values in non-DOM contexts so tests
 * don't blow up.
 */
export function captureBrowserMetadata(): BrowserMetadata {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return {
      userAgent: '',
      url: '',
      viewport: { width: 0, height: 0 },
      screen: { width: 0, height: 0 },
      language: '',
      timezone: '',
      devicePixelRatio: 1,
      capturedAt: new Date().toISOString(),
    };
  }

  return {
    userAgent: navigator.userAgent,
    url: window.location.href,
    referrer: document.referrer || undefined,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    screen: {
      width: window.screen.width,
      height: window.screen.height,
    },
    language: navigator.language,
    // `Intl.DateTimeFormat().resolvedOptions().timeZone` is typed as `string`
    // but actually returns `undefined` on some legacy mobile browsers. Coerce
    // to '' so the API's Zod schema (`z.string().max(64)`) still accepts the
    // payload — the field is best-effort metadata and not worth dropping the
    // whole submission over.
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? '',
    devicePixelRatio: window.devicePixelRatio || 1,
    capturedAt: new Date().toISOString(),
  };
}
