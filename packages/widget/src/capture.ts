import { useEffect } from 'react';
import { captureBrowserMetadata, type BrowserMetadata, type WidgetConfig } from '@koe/shared';
import { startTrail, type Trail } from './trail';

declare const __KOE_WIDGET_VERSION__: string | undefined;

export const WIDGET_VERSION =
  typeof __KOE_WIDGET_VERSION__ === 'string' ? __KOE_WIDGET_VERSION__ : 'dev';

const SCREENSHOT_TIMEOUT_MS = 5000;

let activeTrail: Trail | null = null;

export function useTrail(config: WidgetConfig): void {
  const enabled = config.capture?.trail !== false;
  const keep = config.capture?.keepQueryParams?.join('\n');
  const apiUrl = config.apiUrl;
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const trail = startTrail({
      keepQueryParams: keep ? keep.split('\n') : undefined,
      ignorePrefix: `${apiUrl.replace(/\/$/, '')}/v1/widget/`,
    });
    activeTrail = trail;
    return () => {
      trail.stop();
      if (activeTrail === trail) activeTrail = null;
    };
  }, [enabled, keep, apiUrl]);
}

export function buildMetadata(config: WidgetConfig, { withTrail = false } = {}): BrowserMetadata {
  const metadata = captureBrowserMetadata({
    keepQueryParams: config.capture?.keepQueryParams,
    widgetVersion: WIDGET_VERSION,
    app: config.app,
  });
  if (withTrail && activeTrail) Object.assign(metadata, activeTrail.snapshot());
  return metadata;
}

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
