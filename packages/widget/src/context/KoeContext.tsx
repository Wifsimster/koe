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
  const value = useMemo<KoeContextValue>(() => {
    const locale = mergeLocale(config.locale);
    const api = new KoeApiClient({
      apiUrl: config.apiUrl ?? 'https://api.koe.dev',
      projectKey: config.projectKey,
      userHash: config.userHash,
    });
    return { config, locale, api };
  }, [config]);

  return <KoeContext.Provider value={value}>{children}</KoeContext.Provider>;
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
    tabs: { ...DEFAULT_LOCALE.tabs, ...(override.tabs ?? {}) },
    bugForm: { ...DEFAULT_LOCALE.bugForm, ...(override.bugForm ?? {}) },
    featureForm: { ...DEFAULT_LOCALE.featureForm, ...(override.featureForm ?? {}) },
    chat: { ...DEFAULT_LOCALE.chat, ...(override.chat ?? {}) },
  };
}
