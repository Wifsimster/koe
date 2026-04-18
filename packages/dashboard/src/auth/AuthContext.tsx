import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  AdminApiClient,
  AdminApiError,
  type AdminProject,
  type Me,
} from '../api/client';

const ACTIVE_PROJECT_KEY = 'koe.activeProjectKey';

type AuthState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | {
      status: 'authenticated';
      me: Me;
      projects: AdminProject[];
      activeProjectKey: string | null;
    };

export interface AuthContextValue {
  state: AuthState;
  api: AdminApiClient;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setActiveProject: (key: string) => void;
  /** Re-fetch /me + /projects. Used after creating a project. */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthProviderProps {
  baseUrl: string;
  children: ReactNode;
}

/**
 * Single-admin auth. The server holds the credentials in env vars and
 * the session is a same-origin signed cookie — the dashboard never
 * sees a token. We start in `loading` because the browser may carry a
 * cookie from a prior session, and only `/me` can tell us if it's
 * still valid.
 */
export function AuthProvider({ baseUrl, children }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  const api = useMemo(() => new AdminApiClient({ baseUrl }), [baseUrl]);

  const refresh = useCallback(async () => {
    try {
      const [me, projects] = await Promise.all([api.me(), api.listProjects()]);
      setState({
        status: 'authenticated',
        me,
        projects,
        activeProjectKey: pickActiveProject(projects),
      });
    } catch (err) {
      if (err instanceof AdminApiError && err.status === 401) {
        setState({ status: 'unauthenticated' });
        return;
      }
      console.warn('[koe/dashboard] auth refresh failed', err);
      setState({ status: 'unauthenticated' });
    }
  }, [api]);

  useEffect(() => {
    if (state.status === 'loading') void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  const login = useCallback<AuthContextValue['login']>(
    async (email, password) => {
      await api.loginWithPassword(email, password);
      setState({ status: 'loading' });
    },
    [api],
  );

  const logout = useCallback<AuthContextValue['logout']>(async () => {
    await api.logout();
    setState({ status: 'unauthenticated' });
  }, [api]);

  const setActiveProject = useCallback<AuthContextValue['setActiveProject']>((key) => {
    setState((prev) => {
      if (prev.status !== 'authenticated') return prev;
      try {
        localStorage.setItem(ACTIVE_PROJECT_KEY, key);
      } catch {
        // Private-mode Safari throws — ignore.
      }
      return { ...prev, activeProjectKey: key };
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ state, api, login, logout, setActiveProject, refresh }),
    [state, api, login, logout, setActiveProject, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be called inside <AuthProvider>');
  return ctx;
}

function readStoredActiveProject(): string | null {
  try {
    return localStorage.getItem(ACTIVE_PROJECT_KEY);
  } catch {
    return null;
  }
}

function pickActiveProject(projects: AdminProject[]): string | null {
  if (projects.length === 0) return null;
  const stored = readStoredActiveProject();
  if (stored && projects.some((p) => p.key === stored)) return stored;
  return projects[0]!.key;
}
