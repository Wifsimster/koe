import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { createAdminClient, tokenStore, type KoeAdminClient } from '../api/client';

/**
 * App-level context: the admin transport, the selected project, and
 * the auth token. Kept small on purpose — heavy state (tickets,
 * overview) lives in TanStack Query.
 */
interface AppContextValue {
  client: KoeAdminClient;
  token: string | null;
  setToken: (token: string | null) => void;
  projectKey: string | null;
  setProjectKey: (key: string | null) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

const PROJECT_KEY_STORAGE = 'koe.admin.selectedProjectKey';

export function AppProvider({ children }: { children: ReactNode }) {
  // Single client instance for the app — `setToken` mutates the
  // existing client rather than swapping references, so all hooks
  // already bound to it keep working after login.
  const client = useMemo(() => createAdminClient(), []);

  const [token, setTokenState] = useState<string | null>(() => tokenStore.get());

  const [projectKey, setProjectKeyState] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(PROJECT_KEY_STORAGE);
    } catch {
      return null;
    }
  });

  const setToken = useCallback(
    (next: string | null) => {
      if (next) tokenStore.set(next);
      else tokenStore.clear();
      client.setToken(next);
      setTokenState(next);
    },
    [client],
  );

  const setProjectKey = useCallback((next: string | null) => {
    try {
      if (next) window.localStorage.setItem(PROJECT_KEY_STORAGE, next);
      else window.localStorage.removeItem(PROJECT_KEY_STORAGE);
    } catch {
      /* ignore */
    }
    setProjectKeyState(next);
  }, []);

  // Keep the client in sync with the token on mount. The constructor
  // already read localStorage, but a StrictMode remount could pass a
  // stale instance; cheap belt-and-suspenders.
  useEffect(() => {
    client.setToken(token);
  }, [client, token]);

  const value = useMemo(
    () => ({ client, token, setToken, projectKey, setProjectKey }),
    [client, token, setToken, projectKey, setProjectKey],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
