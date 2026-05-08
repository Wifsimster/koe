import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { WidgetConfig, WidgetLocale } from '@koe/shared';
import { detectBrowserLanguage, resolveLocale } from '@koe/shared';
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

  const locale = useMemo(
    () => mergeLocale(resolveLocale(config.language ?? detectBrowserLanguage()), config.locale),
    [config.language, config.locale],
  );

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

function mergeLocale(base: WidgetLocale, override?: Partial<WidgetLocale>): WidgetLocale {
  if (!override) return base;
  return {
    ...base,
    ...override,
    // Nested groups are deep-merged so hosts can override a single key
    // (e.g. just `picker.bug`) without losing the rest of the base preset.
    picker: override.picker
      ? { ...(base.picker as NonNullable<WidgetLocale['picker']>), ...override.picker }
      : base.picker,
    browse: override.browse
      ? { ...(base.browse as NonNullable<WidgetLocale['browse']>), ...override.browse }
      : base.browse,
    myRequests: override.myRequests
      ? {
          ...(base.myRequests as NonNullable<WidgetLocale['myRequests']>),
          ...override.myRequests,
          status: {
            ...(base.myRequests as NonNullable<WidgetLocale['myRequests']>).status,
            ...(override.myRequests.status ?? {}),
          },
        }
      : base.myRequests,
    tabs: { ...base.tabs, ...(override.tabs ?? {}) },
    bugForm: { ...base.bugForm, ...(override.bugForm ?? {}) },
    featureForm: { ...base.featureForm, ...(override.featureForm ?? {}) },
    chat: { ...base.chat, ...(override.chat ?? {}) },
    errors: { ...base.errors, ...(override.errors ?? {}) },
  };
}
