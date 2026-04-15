import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import type { WidgetConfig } from '@koe/shared';
import { KoeWidget } from './components/KoeWidget';

interface MountedInstance {
  root: Root;
  container: HTMLElement;
}

let instance: MountedInstance | null = null;

/**
 * Mounts the Koe widget into the DOM. Intended for the standalone
 * `<script src="widget.js">` distribution where React isn't the host
 * framework. Calling `init` twice replaces the previous instance.
 */
export function init(config: WidgetConfig): void {
  if (typeof document === 'undefined') {
    throw new Error('Koe.init() can only be called in a browser environment');
  }
  if (!config?.projectKey) {
    throw new Error('Koe.init() requires a projectKey');
  }
  if (instance) {
    destroy();
  }

  const container = document.createElement('div');
  container.id = 'koe-widget-container';
  document.body.appendChild(container);

  const root = createRoot(container);
  root.render(createElement(KoeWidget, config));
  instance = { root, container };
}

/** Tears down the mounted widget, removing it from the DOM. */
export function destroy(): void {
  if (!instance) return;
  instance.root.unmount();
  instance.container.remove();
  instance = null;
}
