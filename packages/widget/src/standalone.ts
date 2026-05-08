import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import type { WidgetConfig } from '@koe/shared';
import { KoeWidget } from './components/KoeWidget';
import { assertApiUrl } from './context/KoeContext';

interface MountedInstance {
  root: Root;
  container: HTMLElement;
}

/**
 * Two states need to be tracked separately:
 *
 *  - `instance` is set when the widget is fully mounted in the DOM.
 *  - `pendingMount` is set when `init()` was called before `<body>` existed
 *    and we deferred mounting until `DOMContentLoaded`. The pending mount
 *    is cancellable so back-to-back `init()` calls (or `destroy()`) don't
 *    race a deferred mount that would otherwise re-attach to a stale DOM.
 */
let instance: MountedInstance | null = null;
let pendingMount: { cancel: () => void } | null = null;

/**
 * Mounts the Koe widget into the DOM. Intended for the standalone
 * `<script src="widget.js">` distribution where React isn't the host
 * framework. Calling `init` twice replaces the previous instance.
 *
 * Safe to call from a `<script>` tag in `<head>` — if `document.body`
 * doesn't exist yet, the mount is deferred to `DOMContentLoaded`. If
 * `destroy()` is called between init and DOMContentLoaded, the pending
 * mount is cancelled so we don't attach a widget the host already tore
 * down. Concurrent `init()` calls cancel any in-flight pending mount and
 * destroy any current instance before mounting the new config.
 */
export function init(config: Omit<WidgetConfig, 'apiUrl'> & { apiUrl?: string }): void {
  if (typeof document === 'undefined') {
    throw new Error('Koe.init() can only be called in a browser environment');
  }
  if (!config?.projectKey) {
    throw new Error('Koe.init() requires a projectKey');
  }
  // The IIFE entrypoint defaults `apiUrl` to the host's own origin so the
  // <script>-tag install path stays one-line for users who self-host the
  // API on the same domain. Library consumers (`<KoeWidget />`) must pass
  // `apiUrl` explicitly — the type makes that a compile error.
  const rawApiUrl =
    config.apiUrl ?? (typeof window !== 'undefined' ? window.location.origin : undefined);
  // Fail fast on a bad `apiUrl` before mounting — identity headers would
  // otherwise be sent to the misconfigured endpoint on first submission.
  // `assertApiUrl` throws when the input is empty/undefined so the
  // returned value is always a validated `string`.
  const apiUrl = assertApiUrl(rawApiUrl);
  const resolvedConfig: WidgetConfig = { ...config, apiUrl };

  // Cancel any in-flight pending mount and tear down any live instance so
  // the new config wins. `destroy()` clears both states.
  destroy();

  if (!document.body) {
    // <script> in <head>: defer the mount until the DOM is parsed enough
    // for `document.body` to exist. Use a one-shot listener so we don't
    // leak when the host tears the page down before DOMContentLoaded.
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

/**
 * Synchronously mount the widget. Caller has already validated `config`
 * and confirmed `document.body` exists.
 */
function mountNow(config: WidgetConfig): void {
  const container = document.createElement('div');
  container.id = 'koe-widget-container';
  document.body.appendChild(container);

  const root = createRoot(container);
  root.render(createElement(KoeWidget, config));
  instance = { root, container };
}

/**
 * Tears down the mounted widget, removing it from the DOM. Also cancels
 * a pending DOMContentLoaded mount if `init()` was called before the
 * body existed and the listener hasn't fired yet.
 */
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
