import { useEffect, useRef, type ReactNode } from 'react';
import {
  createRootRouteWithContext,
  createRoute,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router';
import type { TicketKind, TicketStatus } from '@koe/shared';
import { LoginPage } from './pages/LoginPage';
import { InboxPage } from './pages/InboxPage';
import { TicketDetailPage } from './pages/TicketDetailPage';
import { BatchesPage } from './pages/BatchesPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { OverviewPage } from './pages/OverviewPage';
import { AppShell } from './components/AppShell';
import { useAuth, type AuthContextValue } from './auth/AuthContext';

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
  // Bounce to /login unless we have an authenticated state. State is
  // already resolved by the AuthProvider on mount; loaders see the
  // current snapshot.
  //
  // Empty-projects gate: a fresh deploy with no projects yet lands
  // on /onboarding instead of the inbox.
  beforeLoad: ({ context, location }) => {
    if (context.auth.state.status === 'unauthenticated') {
      throw redirect({
        to: '/login',
        search: { redirectTo: location.pathname },
      });
    }
    if (
      context.auth.state.status === 'authenticated' &&
      context.auth.state.projects.length === 0 &&
      location.pathname !== '/onboarding'
    ) {
      throw redirect({ to: '/onboarding' });
    }
  },
  component: AuthenticatedLayout,
});

export interface InboxSearch {
  kind: TicketKind | 'all';
  status: TicketStatus | 'all';
  q: string;
  sort: 'recent' | 'votes';
}

const VALID_KINDS: ReadonlySet<string> = new Set(['all', 'bug', 'feature']);
const VALID_STATUSES: ReadonlySet<string> = new Set([
  'all',
  'open',
  'in_progress',
  'planned',
  'resolved',
  'closed',
  'wont_fix',
]);
const VALID_SORTS: ReadonlySet<string> = new Set(['recent', 'votes']);

function parseKind(raw: unknown): InboxSearch['kind'] {
  return typeof raw === 'string' && VALID_KINDS.has(raw)
    ? (raw as InboxSearch['kind'])
    : 'all';
}
function parseStatus(raw: unknown): InboxSearch['status'] {
  return typeof raw === 'string' && VALID_STATUSES.has(raw)
    ? (raw as InboxSearch['status'])
    : 'open';
}
function parseSort(raw: unknown): InboxSearch['sort'] {
  return typeof raw === 'string' && VALID_SORTS.has(raw)
    ? (raw as InboxSearch['sort'])
    : 'recent';
}

export const inboxRoute = createRoute({
  getParentRoute: () => authenticatedLayoutRoute,
  path: '/',
  component: InboxPage,
  validateSearch: (raw: Record<string, unknown>): InboxSearch => ({
    kind: parseKind(raw.kind),
    status: parseStatus(raw.status),
    q: typeof raw.q === 'string' ? raw.q.slice(0, 200) : '',
    sort: parseSort(raw.sort),
  }),
});

const ticketDetailRoute = createRoute({
  getParentRoute: () => authenticatedLayoutRoute,
  path: '/tickets/$id',
  component: TicketDetailPage,
});

const batchesRoute = createRoute({
  getParentRoute: () => authenticatedLayoutRoute,
  path: '/batches',
  component: BatchesPage,
});

const onboardingRoute = createRoute({
  getParentRoute: () => authenticatedLayoutRoute,
  path: '/onboarding',
  component: OnboardingPage,
});

const overviewRoute = createRoute({
  getParentRoute: () => authenticatedLayoutRoute,
  path: '/overview',
  component: OverviewPage,
});

export const routeTree = rootRoute.addChildren([
  loginRoute,
  authenticatedLayoutRoute.addChildren([
    inboxRoute,
    ticketDetailRoute,
    batchesRoute,
    onboardingRoute,
    overviewRoute,
  ]),
]);

function RootGate() {
  return <Outlet />;
}

function AuthenticatedLayout() {
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

  // Mid-session empty-projects → /onboarding (mirrors beforeLoad).
  useEffect(() => {
    if (
      state.status === 'authenticated' &&
      state.projects.length === 0 &&
      pathname !== '/onboarding'
    ) {
      void navigate({ to: '/onboarding' });
    }
  }, [state, navigate, pathname]);

  // Multi-project landing — fires once per auth transition.
  const didLandingRef = useRef(false);
  useEffect(() => {
    if (state.status === 'unauthenticated') {
      didLandingRef.current = false;
      return;
    }
    if (
      state.status === 'authenticated' &&
      !didLandingRef.current &&
      state.projects.length >= 2 &&
      pathname === '/'
    ) {
      didLandingRef.current = true;
      void navigate({ to: '/overview' });
    } else if (state.status === 'authenticated') {
      didLandingRef.current = true;
    }
  }, [state, pathname, navigate]);

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
  if (pathname.startsWith('/batches')) {
    return <Crumb label="Batches" caption="Undo bulk actions across the project." />;
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

export const INBOX_DEFAULT_SEARCH: InboxSearch = {
  kind: 'all',
  status: 'open',
  q: '',
  sort: 'recent',
};

function LoadingScreen(): ReactNode {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-sm text-muted-foreground">
      Loading…
    </div>
  );
}
