import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { WidgetConfig, WidgetLocale } from '@koe/shared';
import { DEFAULT_LOCALE } from '@koe/shared';
import { KoeApiClient } from '../api/client';

interface KoeContextValue {
  config: Required<Pick<WidgetConfig, 'projectKey'>> & WidgetConfig;
  locale: WidgetLocale;
  api: KoeApiClient;
}

const KoeContext = createContext<KoeContextValue | null>(null);

export interface KoeProviderProps {
  config: WidgetConfig;
  children: ReactNode;
}

export function KoeProvider({ config, children }: KoeProviderProps) {
  // Depend on the primitive fields the client cares about, not the whole
  // `config` reference. Hosts commonly pass an inline object literal —
  // `<KoeProvider config={{ apiUrl, projectKey }}>` — which would otherwise
  // rebuild the API client (and drop in-flight requests) on every render.
  const { apiUrl, projectKey, userHash, identityToken } = config;
  const api = useMemo(
    () =>
      new KoeApiClient({
        apiUrl: assertApiUrl(apiUrl),
        projectKey,
        userHash,
        identityToken,
      }),
    [apiUrl, projectKey, userHash, identityToken],
  );

  const locale = useMemo(() => mergeLocale(config.locale), [config.locale]);

  const value = useMemo<KoeContextValue>(
    () => ({ config, locale, api }),
    [config, locale, api],
  );

  return <KoeContext.Provider value={value}>{children}</KoeContext.Provider>;
}

/**
 * Validate the `apiUrl` the host passes to the widget. The widget forwards
 * reporter identity (`X-Koe-User-Hash` / `X-Koe-Identity-Token`) on every
 * request, so a misconfigured or attacker-influenced `apiUrl` would
 * silently send identity-bearing payloads to an arbitrary endpoint. We
 * parse it, require an `http(s):` scheme, and refuse `javascript:`,
 * `data:`, protocol-relative, and non-URL inputs.
 *
 * Exported so the standalone `Koe.init()` entrypoint can reuse it.
 */
export function assertApiUrl(raw: string | undefined): string {
  if (!raw || typeof raw !== 'string') {
    throw new Error(
      'Koe: `apiUrl` is required. Pass the URL of your self-hosted Koe service (e.g. "https://api.support.acme.com").',
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Koe: \`apiUrl\` is not a valid absolute URL (got "${raw}").`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(
      `Koe: \`apiUrl\` must use http(s). Got "${parsed.protocol}" — refusing to send identity headers to a non-http(s) endpoint.`,
    );
  }
  return raw;
}

export function useKoe(): KoeContextValue {
  const ctx = useContext(KoeContext);
  if (!ctx) {
    throw new Error('useKoe must be called inside a <KoeProvider>');
  }
  return ctx;
}

function mergeLocale(override?: Partial<WidgetLocale>): WidgetLocale {
  if (!override) return DEFAULT_LOCALE;
  return {
    ...DEFAULT_LOCALE,
    ...override,
    // Nested groups are deep-merged so hosts can override a single key
    // (e.g. just `picker.bug`) without losing the rest of the defaults.
    picker: override.picker
      ? { ...(DEFAULT_LOCALE.picker as NonNullable<WidgetLocale['picker']>), ...override.picker }
      : DEFAULT_LOCALE.picker,
    browse: override.browse
      ? { ...(DEFAULT_LOCALE.browse as NonNullable<WidgetLocale['browse']>), ...override.browse }
      : DEFAULT_LOCALE.browse,
    myRequests: override.myRequests
      ? {
          ...(DEFAULT_LOCALE.myRequests as NonNullable<WidgetLocale['myRequests']>),
          ...override.myRequests,
          status: {
            ...(DEFAULT_LOCALE.myRequests as NonNullable<WidgetLocale['myRequests']>).status,
            ...(override.myRequests.status ?? {}),
          },
        }
      : DEFAULT_LOCALE.myRequests,
    tabs: { ...DEFAULT_LOCALE.tabs, ...(override.tabs ?? {}) },
    bugForm: { ...DEFAULT_LOCALE.bugForm, ...(override.bugForm ?? {}) },
    featureForm: { ...DEFAULT_LOCALE.featureForm, ...(override.featureForm ?? {}) },
    chat: { ...DEFAULT_LOCALE.chat, ...(override.chat ?? {}) },
    errors: { ...DEFAULT_LOCALE.errors, ...(override.errors ?? {}) },
  };
}
