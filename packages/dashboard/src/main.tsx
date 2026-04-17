import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { routeTree, type RouterContext } from './router';
import { AuthProvider, useAuth, type AuthMode } from './auth/AuthContext';
import './styles.css';

// Match the Vite `base` config so the SPA can be mounted under
// `/admin/*` when served by the Koe API, or at `/` in standalone dev.
const basepath = import.meta.env.BASE_URL.replace(/\/$/, '') || undefined;

// Admin API base URL. Defaults to same-origin `/v1/admin` (the API
// serves both the SPA at `/admin/*` and the JSON at `/v1/admin/*`).
// Override with `VITE_ADMIN_API_URL` for a split deploy.
const adminApiBaseUrl = (import.meta.env.VITE_ADMIN_API_URL as string | undefined) ?? '/v1/admin';

// Auth endpoints live alongside the JSON API. Kept relative so the
// `credentials: 'include'` cookie travels same-origin. `loginUrl` is
// OIDC-only (used for the full-page redirect); `logoutUrl` is shared
// between OIDC and password modes — both clear the same session cookie.
const adminLoginUrl = `${adminApiBaseUrl}/auth/login`;
const adminLogoutUrl = `${adminApiBaseUrl}/auth/logout`;

const router = createRouter({
  routeTree,
  basepath,
  // Dummy context at construction — replaced each render with the
  // live auth value so route loaders see the current state.
  context: undefined as unknown as RouterContext,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

function App() {
  const auth = useAuth();
  return <RouterProvider router={router} context={{ auth }} />;
}

/**
 * Resolves the auth transport at runtime via `GET /v1/admin/auth/config`.
 *
 * Moved off `VITE_ADMIN_AUTH_MODE` so a single published image serves
 * every auth mode — the operator flips `ADMIN_AUTH_MODE` on the
 * container and the dashboard bundle picks up the right login form on
 * next load. Otherwise the SPA would lock in whatever mode the image
 * was built with (historically `oidc`) and deployments on `password`
 * would render the wrong form.
 *
 * Failures are loud on purpose: if we can't reach the admin API at
 * all, logging in is impossible regardless of what form we'd render.
 */
function Bootstrap() {
  const [mode, setMode] = useState<AuthMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${adminApiBaseUrl}/auth/config`, {
          credentials: 'include',
        });
        if (!res.ok) {
          throw new Error(
            res.status === 404
              ? 'Admin API is not mounted. Set ADMIN_AUTH_MODE on the server.'
              : `Auth config request failed (HTTP ${res.status}).`,
          );
        }
        const body = (await res.json()) as
          | { ok: true; data: { mode: AuthMode } }
          | { ok: false; error: { message: string } };
        if (!body.ok) throw new Error(body.error.message);
        if (!cancelled) setMode(body.data.mode);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <BootError message={error} />;
  if (!mode) return <BootLoading />;

  return (
    <AuthProvider
      baseUrl={adminApiBaseUrl}
      mode={mode}
      loginUrl={adminLoginUrl}
      logoutUrl={adminLogoutUrl}
    >
      <App />
    </AuthProvider>
  );
}

function BootLoading(): ReactNode {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-sm text-muted-foreground">
      Loading…
    </div>
  );
}

function BootError({ message }: { message: string }): ReactNode {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-md border-l-2 border-destructive/70 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        <div className="font-medium">Admin API unavailable</div>
        <div className="mt-1">{message}</div>
      </div>
    </div>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('#root element missing');

createRoot(container).render(
  <StrictMode>
    <Bootstrap />
  </StrictMode>,
);
