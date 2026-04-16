import type { ReactNode } from 'react';
import { createRootRouteWithContext, createRoute, Outlet, redirect } from '@tanstack/react-router';
import { LoginPage } from './pages/LoginPage';
import { InboxPage } from './pages/InboxPage';
import { TicketDetailPage } from './pages/TicketDetailPage';
import { AppShell } from './components/AppShell';
import { useAuth, type AuthContextValue } from './auth/AuthContext';

/**
 * Router context: the auth state plugged into `createRouter` in
 * main.tsx. Loaders read from here to decide whether to `redirect`
 * to `/login`, so the guard is centralized at the route level (not
 * duplicated in every page component).
 */
export interface RouterContext {
  auth: AuthContextValue;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootGate,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

const authenticatedLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: '_authenticated',
  // Bounce to /login unless we have an authenticated state. We
  // don't await anything — the state is already resolved by the
  // AuthProvider at mount; loaders see its current snapshot.
  beforeLoad: ({ context, location }) => {
    if (context.auth.state.status === 'unauthenticated') {
      throw redirect({
        to: '/login',
        search: { redirectTo: location.pathname },
      });
    }
  },
  component: AuthenticatedLayout,
});

const inboxRoute = createRoute({
  getParentRoute: () => authenticatedLayoutRoute,
  path: '/',
  component: InboxPage,
});

const ticketDetailRoute = createRoute({
  getParentRoute: () => authenticatedLayoutRoute,
  path: '/tickets/$id',
  component: TicketDetailPage,
});

export const routeTree = rootRoute.addChildren([
  loginRoute,
  authenticatedLayoutRoute.addChildren([inboxRoute, ticketDetailRoute]),
]);

function RootGate() {
  // Top-level outlet. The auth gate lives on the `_authenticated`
  // parent route, so this layer just renders whatever matched.
  return <Outlet />;
}

function AuthenticatedLayout() {
  const { state } = useAuth();
  if (state.status === 'loading') {
    return <LoadingScreen />;
  }
  // beforeLoad redirects unauthenticated; reaching here without
  // being authenticated would be a guard bug — render loud.
  if (state.status !== 'authenticated') {
    return <div className="p-8 text-red-600">Auth guard bypassed.</div>;
  }
  return (
    <AppShell
      header={
        <div>
          <h2 className="text-xl md:text-2xl font-semibold">Inbox</h2>
          <p className="text-sm text-gray-600">
            Triage incoming bug reports and feature requests.
          </p>
        </div>
      }
    >
      <Outlet />
    </AppShell>
  );
}

function LoadingScreen(): ReactNode {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 text-sm text-gray-500">
      Loading…
    </div>
  );
}
