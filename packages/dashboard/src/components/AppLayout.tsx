import { useEffect, useRef, type ReactNode } from 'react';
import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useAuth } from '../auth/AuthContext';
import { AppShell } from './AppShell';

/**
 * Route components for the router. They live here, not in `router.tsx`,
 * so that file exports only route config — a module that mixes component
 * definitions with non-component exports breaks React Fast Refresh and
 * trips `only-export-components` / `no-multi-comp`.
 */

export function RootGate() {
  return <Outlet />;
}

export function AuthenticatedLayout() {
  const { state } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Mid-session 401 → kick to /login. beforeLoad only runs on
  // navigation, so this mirror catches the case where /me starts
  // returning 401 after the route already matched.
  useEffect(() => {
    if (state.status === 'unauthenticated' && pathname !== '/login') {
      void navigate({ to: '/login', search: { redirectTo: pathname } });
    }
  }, [state.status, navigate, pathname]);

  // Pull the specific fields the effects below depend on. Depending on
  // the whole `state` object would re-run them on every setState (the
  // reference always changes) — including non-structural transitions
  // like `setActiveProject`, which has nothing to do with redirects.
  const authStatus = state.status;
  const projectCount = state.status === 'authenticated' ? state.projects.length : 0;

  // Mid-session empty-projects → /onboarding (mirrors beforeLoad).
  useEffect(() => {
    if (
      authStatus === 'authenticated' &&
      projectCount === 0 &&
      pathname !== '/onboarding'
    ) {
      void navigate({ to: '/onboarding' });
    }
  }, [authStatus, projectCount, navigate, pathname]);

  // Multi-project landing — fires once per auth transition.
  const didLandingRef = useRef(false);
  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      didLandingRef.current = false;
      return;
    }
    if (
      authStatus === 'authenticated' &&
      !didLandingRef.current &&
      projectCount >= 2 &&
      pathname === '/'
    ) {
      didLandingRef.current = true;
      void navigate({ to: '/overview' });
    } else if (authStatus === 'authenticated') {
      didLandingRef.current = true;
    }
  }, [authStatus, projectCount, pathname, navigate]);

  if (state.status !== 'authenticated') {
    return <LoadingScreen />;
  }
  if (pathname === '/onboarding') {
    return <Outlet />;
  }
  return (
    <AppShell header={<RouteHeader />}>
      <Outlet />
    </AppShell>
  );
}

function RouteHeader(): ReactNode {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname === '/overview') {
    return <Crumb label="Overview" caption="Every project at a glance." />;
  }
  if (pathname.startsWith('/tickets/')) {
    return <Crumb label="Ticket" caption="Triage, route, respond." />;
  }
  return <Crumb label="Inbox" caption="Triage bugs and ideas as they arrive." />;
}

function Crumb({ label, caption }: { label: string; caption: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="font-heading text-base tracking-tight">{label}</span>
      <span className="hidden text-[11px] text-muted-foreground sm:inline">{caption}</span>
    </div>
  );
}

function LoadingScreen(): ReactNode {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-sm text-muted-foreground">
      Loading…
    </div>
  );
}
