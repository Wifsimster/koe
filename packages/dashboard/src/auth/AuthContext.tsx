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

export type AuthMode = 'oidc' | 'dev-session';

type AuthState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'authenticated'; me: Me; activeProjectKey: string | null };

export interface AuthContextValue {
  mode: AuthMode;
  state: AuthState;
  api: AdminApiClient;
  /**
   * In `dev-session` mode, accepts the raw token pasted from the CLI.
   * In `oidc` mode, triggers a full-page redirect to the provider
   * login URL — the `token` arg is ignored.
   */
  login: (token?: string) => Promise<void>;
  logout: () => Promise<void>;
  setActiveProject: (key: string) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthProviderProps {
  baseUrl: string;
  /** Auth transport — picked by the API deployment, surfaced via
   *  `VITE_ADMIN_AUTH_MODE`. Default is `oidc`. */
  mode?: AuthMode;
  /** Kick-off URL for the OIDC dance, passed through to the API
   *  client so 401s can redirect. Ignored in dev-session mode. */
  loginUrl?: string;
  /** Server-side logout endpoint that clears the session cookie. */
  logoutUrl?: string;
  children: ReactNode;
}

/**
 * Holds the current user + memberships + active project.
 *
 * Two transports, one shape:
 *   - `oidc`        → session travels in a same-origin cookie set by
 *                     the `/v1/admin/auth/callback` handler. We never
 *                     see the token; `/me` validates the cookie on
 *                     each call.
 *   - `dev-session` → the CLI-issued bearer token lives in
 *                     localStorage. Clunky, interim, explicitly
 *                     dev-only. Preserved so local contributors
 *                     working without an OIDC provider can still use
 *                     the dashboard.
 */
export function AuthProvider({ baseUrl, mode = 'oidc', loginUrl, logoutUrl, children }: AuthProviderProps) {
  const tokenRef = useRef<string | null>(
    mode === 'dev-session' ? readStoredToken() : null,
  );

  // In OIDC mode we always start in `loading` — the browser might
  // carry a valid cookie from a previous session and we need to call
  // /me to find out. In dev-session mode we only go to `loading` if
  // we already have a token on disk.
  const initialState: AuthState =
    mode === 'oidc' || tokenRef.current ? { status: 'loading' } : { status: 'unauthenticated' };
  const [state, setState] = useState<AuthState>(initialState);

  const api = useMemo(
    () =>
      new AdminApiClient({
        baseUrl,
        getToken: mode === 'dev-session' ? () => tokenRef.current : undefined,
        loginUrl,
        logoutUrl,
      }),
    [baseUrl, mode, loginUrl, logoutUrl],
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
      // Transient network / server error: stay unauthenticated
      // rather than leave the app in a half-loaded state. The login
      // screen will show and the user can retry.
      console.warn('[koe/dashboard] /me failed', err);
      clearAuth();
    }
  }, [api, clearAuth]);

  useEffect(() => {
    if (state.status === 'loading') void fetchMe();
    // fetchMe is stable; we only want this to re-run when we move
    // back into 'loading' (after a successful login or on mount).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  const login = useCallback<AuthContextValue['login']>(
    async (token) => {
      if (mode === 'oidc') {
        // Full-page redirect to the provider. Carries where we'd like
        // to land after the callback.
        api.redirectToLogin(window.location.pathname);
        return;
      }
      // dev-session mode — caller passed the raw token.
      if (!token) throw new Error('dev-session login requires a token');
      tokenRef.current = token;
      try {
        localStorage.setItem(TOKEN_KEY, token);
      } catch {
        // see clearAuth
      }
      setState({ status: 'loading' });
    },
    [api, mode],
  );

  const logout = useCallback<AuthContextValue['logout']>(async () => {
    if (mode === 'oidc') {
      await api.logout();
    }
    clearAuth();
  }, [api, clearAuth, mode]);

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
    () => ({ mode, state, api, login, logout, setActiveProject }),
    [mode, state, api, login, logout, setActiveProject],
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
