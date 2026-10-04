import {
  redactText,
  redactUrl,
  type Breadcrumb,
  type BreadcrumbTarget,
  type ConsoleEntry,
  type NetworkEntry,
} from '@koe/shared';

/**
 * Bounded recorder for what happened before a bug report: user actions,
 * console errors and warnings, and failed requests. Attached to bug
 * reports as `metadata.breadcrumbs`, `metadata.console` and
 * `metadata.network`.
 *
 * Privacy rules:
 * - Fields: a breadcrumb names the field (label, role), never its value.
 *   Keystrokes are not observed at all; one `input` breadcrumb is written
 *   per `change` event.
 * - URLs go through `redactUrl` (query and hash values dropped), console
 *   text through `redactText` (tokens, e-mails, URL values).
 * - Interactions inside the widget itself are not recorded.
 * - Each buffer keeps only its last N entries.
 */

export const TRAIL_LIMITS = { breadcrumbs: 30, console: 20, network: 20 } as const;
const NAME_MAX = 80;

export interface TrailSnapshot {
  breadcrumbs: Breadcrumb[];
  console: ConsoleEntry[];
  network: NetworkEntry[];
}

interface TrailOptions {
  keepQueryParams?: readonly string[];
  /** Requests under this URL prefix (the widget's own API calls) are not recorded. */
  ignorePrefix?: string;
}

function push<T>(buf: T[], entry: T, max: number): void {
  buf.push(entry);
  if (buf.length > max) buf.splice(0, buf.length - max);
}

const now = () => new Date().toISOString();
const clip = (s: string) => redactText(s.replace(/\s+/g, ' ').trim(), NAME_MAX);

const INTERACTIVE =
  'button, a[href], input, select, textarea, summary, label, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="switch"], [role="option"], [data-testid]';

const IMPLICIT_ROLE: Record<string, string> = {
  button: 'button',
  a: 'link',
  select: 'combobox',
  textarea: 'textbox',
  summary: 'button',
};

function inputRole(el: HTMLInputElement): string {
  switch (el.type) {
    case 'checkbox':
      return 'checkbox';
    case 'radio':
      return 'radio';
    case 'button':
    case 'submit':
    case 'reset':
      return 'button';
    case 'range':
      return 'slider';
    case 'search':
      return 'searchbox';
    default:
      return 'textbox';
  }
}

function isField(el: Element): boolean {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  );
}

/** Accessible name without ever reading a field's value. */
function accessibleName(el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return clip(aria);
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '')
      .join(' ');
    if (text.trim()) return clip(text);
  }
  if (isField(el)) {
    const field = el as HTMLInputElement;
    if (field.type === 'submit' || field.type === 'button' || field.type === 'reset') {
      return clip(field.value || field.type);
    }
    const label = field.labels?.[0]?.textContent;
    if (label) return clip(label);
    return clip(field.getAttribute('placeholder') ?? field.name ?? '');
  }
  return clip((el as HTMLElement).innerText ?? el.textContent ?? '');
}

export function describeTarget(el: Element): BreadcrumbTarget {
  const tag = el.tagName.toLowerCase();
  const role =
    el.getAttribute('role') ??
    (el instanceof HTMLInputElement ? inputRole(el) : IMPLICIT_ROLE[tag]);
  const testId = el.getAttribute('data-testid') ?? undefined;
  const name = accessibleName(el);
  return {
    tag,
    ...(role ? { role } : {}),
    ...(name ? { name } : {}),
    ...(testId ? { testId: testId.slice(0, 100) } : {}),
  };
}

function formatArg(arg: unknown): string {
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(arg) ?? String(arg);
  } catch {
    return String(arg);
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * Starts recording. Returns a handle with `snapshot()` and `stop()`.
 * `stop()` restores every patched function and removes every listener.
 */
export function startTrail(options: TrailOptions = {}) {
  const breadcrumbs: Breadcrumb[] = [];
  const consoleBuf: ConsoleEntry[] = [];
  const network: NetworkEntry[] = [];
  const keep = options.keepQueryParams;
  const url = (u: string) => redactUrl(u, { keepQueryParams: keep });
  const cleanups: Array<() => void> = [];

  const inWidget = (el: Element | null) => !!el?.closest('.koe-root');
  const ignored = (u: string) => {
    if (!options.ignorePrefix) return false;
    try {
      return new URL(u, location.href).href.startsWith(options.ignorePrefix);
    } catch {
      return false;
    }
  };

  const navigation = () =>
    push(
      breadcrumbs,
      { ts: now(), type: 'navigation', url: url(location.href) },
      TRAIL_LIMITS.breadcrumbs,
    );
  navigation();

  const onClick = (e: Event) => {
    const start = e.target instanceof Element ? e.target : null;
    const el = start?.closest(INTERACTIVE) ?? start;
    if (!el || inWidget(el)) return;
    // A click on a text field is focus, not an action worth replaying.
    if (isField(el) && inputRole(el as HTMLInputElement) === 'textbox') return;
    push(
      breadcrumbs,
      { ts: now(), type: 'click', target: describeTarget(el) },
      TRAIL_LIMITS.breadcrumbs,
    );
  };
  const onChange = (e: Event) => {
    const el = e.target instanceof Element ? e.target : null;
    if (!el || inWidget(el) || !isField(el)) return;
    push(
      breadcrumbs,
      { ts: now(), type: 'input', target: describeTarget(el) },
      TRAIL_LIMITS.breadcrumbs,
    );
  };
  document.addEventListener('click', onClick, true);
  document.addEventListener('change', onChange, true);
  window.addEventListener('popstate', navigation);
  window.addEventListener('hashchange', navigation);
  cleanups.push(() => {
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('change', onChange, true);
    window.removeEventListener('popstate', navigation);
    window.removeEventListener('hashchange', navigation);
  });

  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method];
    history[method] = function (this: History, ...args: Parameters<History['pushState']>) {
      const result = original.apply(this, args);
      navigation();
      return result;
    };
    cleanups.push(() => {
      history[method] = original;
    });
  }

  const logConsole = (level: ConsoleEntry['level'], text: string) =>
    push(consoleBuf, { ts: now(), level, message: redactText(text) }, TRAIL_LIMITS.console);
  for (const level of ['error', 'warn'] as const) {
    const original = console[level];
    console[level] = function (...args: unknown[]) {
      logConsole(level, args.map(formatArg).join(' '));
      return original.apply(this, args);
    };
    cleanups.push(() => {
      console[level] = original;
    });
  }
  const onError = (e: ErrorEvent) => logConsole('error', `Uncaught ${e.message}`);
  const onRejection = (e: PromiseRejectionEvent) =>
    logConsole('error', `Unhandled rejection: ${formatArg(e.reason)}`);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  cleanups.push(() => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  });

  const logRequest = (method: string, target: string, status: number, started: number) => {
    if (ignored(target) || (status > 0 && status < 400)) return;
    push(
      network,
      {
        ts: now(),
        method: method.toUpperCase().slice(0, 16),
        url: url(target),
        status,
        durationMs: Math.round(performance.now() - started),
      },
      TRAIL_LIMITS.network,
    );
  };

  if (typeof window.fetch === 'function') {
    const originalFetch = window.fetch;
    window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
      const started = performance.now();
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      const target = requestUrl(input);
      try {
        const res = await originalFetch.call(this, input, init);
        logRequest(method, target, res.status, started);
        return res;
      } catch (err) {
        logRequest(method, target, 0, started);
        throw err;
      }
    };
    cleanups.push(() => {
      window.fetch = originalFetch;
    });
  }

  if (typeof XMLHttpRequest !== 'undefined') {
    const proto = XMLHttpRequest.prototype;
    const originalOpen = proto.open;
    const originalSend = proto.send;
    const meta = new WeakMap<XMLHttpRequest, { method: string; url: string }>();
    proto.open = function (
      this: XMLHttpRequest,
      method: string,
      target: string | URL,
      ...rest: unknown[]
    ) {
      meta.set(this, { method, url: String(target) });
      return (originalOpen as (...a: unknown[]) => void).call(this, method, target, ...rest);
    } as typeof proto.open;
    proto.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      const info = meta.get(this);
      const started = performance.now();
      if (info) {
        this.addEventListener(
          'loadend',
          () => logRequest(info.method, info.url, this.status, started),
          {
            once: true,
          },
        );
      }
      return originalSend.call(this, body);
    };
    cleanups.push(() => {
      proto.open = originalOpen;
      proto.send = originalSend;
    });
  }

  return {
    snapshot(): TrailSnapshot {
      return { breadcrumbs: [...breadcrumbs], console: [...consoleBuf], network: [...network] };
    },
    stop() {
      while (cleanups.length) cleanups.pop()?.();
    },
  };
}

export type Trail = ReturnType<typeof startTrail>;
