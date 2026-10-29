import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import type { WidgetConfig } from '@koe/shared';
import { KoeWidget } from './components/KoeWidget';
import { assertApiUrl } from './context/KoeContext';

interface MountedInstance {
  root: Root;
  container: HTMLElement;
}

let instance: MountedInstance | null = null;
let pendingMount: { cancel: () => void } | null = null;

export function init(config: Omit<WidgetConfig, 'apiUrl'> & { apiUrl?: string }): void {
  if (typeof document === 'undefined') {
    throw new Error('Koe.init() can only be called in a browser environment');
  }
  if (!config?.projectKey) {
    throw new Error('Koe.init() requires a projectKey');
  }
  const rawApiUrl =
    config.apiUrl ?? (typeof window !== 'undefined' ? window.location.origin : undefined);
  const apiUrl = assertApiUrl(rawApiUrl);
  const resolvedConfig: WidgetConfig = { ...config, apiUrl };

  destroy();

  if (!document.body) {
    let cancelled = false;
    const onReady = () => {
      document.removeEventListener('DOMContentLoaded', onReady);
      pendingMount = null;
      if (cancelled) return;
      mountNow(resolvedConfig);
    };
    pendingMount = {
      cancel: () => {
        cancelled = true;
        document.removeEventListener('DOMContentLoaded', onReady);
      },
    };
    document.addEventListener('DOMContentLoaded', onReady, { once: true });
    return;
  }

  mountNow(resolvedConfig);
}

function mountNow(config: WidgetConfig): void {
  const container = document.createElement('div');
  container.id = 'koe-widget-container';
  document.body.appendChild(container);

  const root = createRoot(container);
  root.render(createElement(KoeWidget, config));
  instance = { root, container };
}

export function destroy(): void {
  if (pendingMount) {
    pendingMount.cancel();
    pendingMount = null;
  }
  if (!instance) return;
  instance.root.unmount();
  instance.container.remove();
  instance = null;
}
