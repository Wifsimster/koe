import { captureBrowserMetadata, type BrowserMetadata, type WidgetConfig } from '@koe/shared';

declare const __KOE_WIDGET_VERSION__: string | undefined;

/** Build-time widget version (`git describe`), `dev` when not injected. */
export const WIDGET_VERSION =
  typeof __KOE_WIDGET_VERSION__ === 'string' ? __KOE_WIDGET_VERSION__ : 'dev';

const SCREENSHOT_TIMEOUT_MS = 5000;

/** Report context for a submission: environment, versions, input capability, redacted URLs. */
export function buildMetadata(config: WidgetConfig): BrowserMetadata {
  return captureBrowserMetadata({
    keepQueryParams: config.capture?.keepQueryParams,
    widgetVersion: WIDGET_VERSION,
    app: config.app,
  });
}

/**
 * Runs the host's `captureScreenshot` hook. Resolves `undefined` when the
 * hook is absent, rejects, times out, or returns something other than an
 * http(s) URL: a screenshot never blocks a report.
 */
export async function hostScreenshot(config: WidgetConfig): Promise<string | undefined> {
  const hook = config.captureScreenshot;
  if (!hook) return undefined;
  try {
    const url = await Promise.race([
      hook(),
      new Promise<undefined>((resolve) =>
        setTimeout(() => resolve(undefined), SCREENSHOT_TIMEOUT_MS),
      ),
    ]);
    return typeof url === 'string' && /^https?:\/\//i.test(url) && url.length <= 2048
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}
