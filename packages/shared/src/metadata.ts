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
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    devicePixelRatio: window.devicePixelRatio || 1,
    capturedAt: new Date().toISOString(),
  };
}
