import { createRootRouteWithContext, createRoute, redirect } from '@tanstack/react-router';
import { LoginPage } from './pages/LoginPage';
import { InboxPage } from './pages/InboxPage';
import { TicketDetailPage } from './pages/TicketDetailPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { OverviewPage } from './pages/OverviewPage';
import { AuthenticatedLayout, RootGate } from './components/AppLayout';
import type { AuthContextValue } from './auth/AuthContext';
import { RouteErrorView } from './components/RouteFallbacks';
import type { InboxSearch, LoginSearch } from './lib/searchParams';

export interface RouterContext {
  auth: AuthContextValue;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootGate,
});

function sanitiseRedirectTo(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  if (raw.length === 0 || raw.length > 2048) return undefined;
  if (!raw.startsWith('/')) return undefined;
  if (raw.startsWith('//') || raw.startsWith('/\\')) return undefined;
  if (/^\/+[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return undefined;
  if (/\s/.test(raw)) return undefined;
  return raw;
}

export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
  validateSearch: (raw: Record<string, unknown>): LoginSearch => {
    const redirectTo = sanitiseRedirectTo(raw.redirectTo);
    return redirectTo ? { redirectTo } : {};
  },
});

const authenticatedLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: '_authenticated',
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
  errorComponent: RouteErrorView,
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
    onboardingRoute,
    overviewRoute,
  ]),
]);

