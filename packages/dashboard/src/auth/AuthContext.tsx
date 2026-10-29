import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
  refresh: () => Promise<void>;
  transientError: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthProviderProps {
  baseUrl: string;
  children: ReactNode;
}

export function AuthProvider({ baseUrl, children }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const [transientError, setTransientError] = useState(false);

  const api = useMemo(() => new AdminApiClient({ baseUrl }), [baseUrl]);

  const refreshControllerRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    refreshControllerRef.current?.abort();
    const controller = new AbortController();
    refreshControllerRef.current = controller;
    try {
      const [me, projects] = await Promise.all([api.me(), api.listProjects()]);
      if (!controller.signal.aborted) {
        setTransientError(false);
        setState({
          status: 'authenticated',
          me,
          projects,
          activeProjectKey: pickActiveProject(projects),
        });
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (err instanceof AdminApiError) {
        if (
          err.status === 401 ||
          err.code === 'unauthorized' ||
          err.code === 'forbidden'
        ) {
          setTransientError(false);
          setState({ status: 'unauthenticated' });
          return;
        }
        if (err.code === 'network_error' || err.code === 'server_error') {
          console.warn('[koe/dashboard] auth refresh transient error', err);
          setTransientError(true);
          setState((prev) =>
            prev.status === 'loading' ? { status: 'unauthenticated' } : prev,
          );
          return;
        }
      }
      console.warn('[koe/dashboard] auth refresh failed', err);
      setTransientError(false);
      setState({ status: 'unauthenticated' });
    } finally {
      if (refreshControllerRef.current === controller) {
        refreshControllerRef.current = null;
      }
    }
  }, [api]);

  useEffect(() => {
    void refresh();
    const controller = refreshControllerRef.current;
    return () => controller?.abort();
  }, [refresh]);

  const login = useCallback<AuthContextValue['login']>(
    async (email, password) => {
      await api.loginWithPassword(email, password);
      setTransientError(false);
      await refresh();
    },
    [api, refresh],
  );

  const logout = useCallback<AuthContextValue['logout']>(async () => {
    refreshControllerRef.current?.abort();
    refreshControllerRef.current = null;
    await api.logout();
    setTransientError(false);
    setState({ status: 'unauthenticated' });
  }, [api]);

  const setActiveProject = useCallback<AuthContextValue['setActiveProject']>((key) => {
    setState((prev) => {
      if (prev.status !== 'authenticated') return prev;
      try {
        localStorage.setItem(ACTIVE_PROJECT_KEY, key);
      } catch {
      }
      return { ...prev, activeProjectKey: key };
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ state, api, login, logout, setActiveProject, refresh, transientError }),
    [state, api, login, logout, setActiveProject, refresh, transientError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = use(AuthContext);
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
