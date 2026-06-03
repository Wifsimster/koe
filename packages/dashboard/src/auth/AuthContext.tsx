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
  /** Re-fetch /me + /projects. Used after creating a project. */
  refresh: () => Promise<void>;
  /**
   * True when the most recent refresh hit a transient error (network
   * down, 5xx) but the user is still considered authenticated. UI can
   * choose to surface a soft warning; we never log the user out for a
   * transient blip — that would interrupt active work.
   */
  transientError: boolean;
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
  const [transientError, setTransientError] = useState(false);

  const api = useMemo(() => new AdminApiClient({ baseUrl }), [baseUrl]);

  // Single in-flight refresh — navigation away aborts the previous
  // call so a slow /me doesn't clobber state after we've moved on.
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
      // Only flip to `unauthenticated` on a real auth failure. A
      // transient network blip or a 5xx must NOT log the user out —
      // that would punish them for the server's bad day.
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
          // Preserve current state. If we were already authenticated,
          // stay there. If we were `loading`, downgrade to
          // `unauthenticated` so the login screen still shows up (a
          // first-load network failure isn't recoverable without an
          // explicit user action).
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

  // Probe the cookie once on mount; the browser may carry a session
  // from a prior visit and only /me can confirm it's still valid. The
  // controller is copied into a local so the cleanup aborts *this*
  // probe rather than reading the ref (which a later refresh may have
  // already replaced) on unmount.
  useEffect(() => {
    void refresh();
    const controller = refreshControllerRef.current;
    return () => controller?.abort();
  }, [refresh]);

  const login = useCallback<AuthContextValue['login']>(
    async (email, password) => {
      await api.loginWithPassword(email, password);
      setTransientError(false);
      // Re-fetch /me + /projects straight from the handler that caused
      // the change, rather than flipping to a `loading` state and
      // letting an effect react to it.
      await refresh();
    },
    [api, refresh],
  );

  const logout = useCallback<AuthContextValue['logout']>(async () => {
    // Abort any in-flight refresh first. Without this, a /me + /projects
    // response that landed during the logout round-trip would resolve
    // after the state flip and re-mark the user as authenticated — the
    // dashboard would bounce back to the inbox instead of the login page.
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
        // Private-mode Safari throws — ignore.
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
