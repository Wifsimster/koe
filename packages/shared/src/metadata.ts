import type { BrowserMetadata } from './types/ticket';
import { redactUrl, type RedactUrlOptions } from './redact';

export interface CaptureOptions extends RedactUrlOptions {
  widgetVersion?: string;
  app?: BrowserMetadata['app'];
}

export function captureBrowserMetadata(options: CaptureOptions = {}): BrowserMetadata {
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

  const match = (q: string) =>
    typeof window.matchMedia === 'function' ? window.matchMedia(q).matches : false;
  return {
    userAgent: navigator.userAgent,
    url: redactUrl(window.location.href, options),
    referrer: document.referrer ? redactUrl(document.referrer) : undefined,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    screen: {
      width: window.screen.width,
      height: window.screen.height,
    },
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? '',
    devicePixelRatio: window.devicePixelRatio || 1,
    capturedAt: new Date().toISOString(),
    redaction: 'query-values',
    pageLoadedAt:
      typeof performance !== 'undefined' && performance.timeOrigin
        ? new Date(performance.timeOrigin).toISOString()
        : undefined,
    widgetVersion: options.widgetVersion,
    app: options.app,
    input: {
      maxTouchPoints: navigator.maxTouchPoints ?? 0,
      coarsePointer: match('(pointer: coarse)'),
      hover: match('(hover: hover)'),
    },
  };
}
