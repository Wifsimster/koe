import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AdminApiClient, AdminApiError, type Me, type Membership } from '../api/client';

const TOKEN_KEY = 'koe.adminToken';
const ACTIVE_PROJECT_KEY = 'koe.activeProjectKey';

type AuthState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'authenticated'; me: Me; activeProjectKey: string | null };

export interface AuthContextValue {
  state: AuthState;
  api: AdminApiClient;
  login: (token: string) => Promise<void>;
  logout: () => void;
  setActiveProject: (key: string) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthProviderProps {
  baseUrl: string;
  children: ReactNode;
}

/**
 * Holds the admin token, the current user + memberships, and the active
 * project key. Token persistence is localStorage — clunky and interim;
 * the real auth flow (OIDC) replaces this whole mechanism in a later
 * MR. Until then, paste-from-CLI is the login UX.
 *
 * The API client is constructed once and reads the token on each call
 * through a closure, so `login`/`logout` don't need to swap clients.
 */
export function AuthProvider({ baseUrl, children }: AuthProviderProps) {
  const tokenRef = useRef<string | null>(readStoredToken());
  const [state, setState] = useState<AuthState>(
    tokenRef.current ? { status: 'loading' } : { status: 'unauthenticated' },
  );

  const api = useMemo(
    () => new AdminApiClient({ baseUrl, getToken: () => tokenRef.current }),
    [baseUrl],
  );

  const clearAuth = useCallback(() => {
    tokenRef.current = null;
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      // Private-mode Safari throws on localStorage — token was
      // in-memory only, nothing to clean up.
    }
    setState({ status: 'unauthenticated' });
  }, []);

  const fetchMe = useCallback(async () => {
    try {
      const me = await api.me();
      setState({
        status: 'authenticated',
        me,
        activeProjectKey: pickActiveProject(me.memberships),
      });
    } catch (err) {
      if (err instanceof AdminApiError && err.status === 401) {
        clearAuth();
        return;
      }
      // Transient network / server error: stay unauthenticated rather
      // than leave the app in a half-loaded state. The login screen
      // will show and the user can retry.
      console.warn('[koe/dashboard] /me failed', err);
      clearAuth();
    }
  }, [api, clearAuth]);

  useEffect(() => {
    if (state.status === 'loading') void fetchMe();
    // fetchMe is stable; we only want this to re-run when we move back
    // into 'loading' (after a successful login).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  const login = useCallback<AuthContextValue['login']>(
    async (token) => {
      tokenRef.current = token;
      try {
        localStorage.setItem(TOKEN_KEY, token);
      } catch {
        // See clearAuth — acceptable fallback, session is just
        // in-memory for private-mode users.
      }
      setState({ status: 'loading' });
    },
    [],
  );

  const logout = useCallback<AuthContextValue['logout']>(() => {
    clearAuth();
  }, [clearAuth]);

  const setActiveProject = useCallback<AuthContextValue['setActiveProject']>((key) => {
    setState((prev) => {
      if (prev.status !== 'authenticated') return prev;
      try {
        localStorage.setItem(ACTIVE_PROJECT_KEY, key);
      } catch {
        // ignored — same localStorage caveat
      }
      return { ...prev, activeProjectKey: key };
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ state, api, login, logout, setActiveProject }),
    [state, api, login, logout, setActiveProject],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be called inside <AuthProvider>');
  return ctx;
}

function readStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function readStoredActiveProject(): string | null {
  try {
    return localStorage.getItem(ACTIVE_PROJECT_KEY);
  } catch {
    return null;
  }
}

function pickActiveProject(memberships: Membership[]): string | null {
  if (memberships.length === 0) return null;
  const stored = readStoredActiveProject();
  if (stored && memberships.some((m) => m.projectKey === stored)) return stored;
  return memberships[0]!.projectKey;
}
