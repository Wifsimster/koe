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

/**
 * Same-origin guard for the post-login `redirectTo`. The auth gate
 * encodes the original pathname in the `/login?redirectTo=...` search
 * param; an attacker who manages to land a victim on
 * `/login?redirectTo=https://evil.com` must NOT bounce them off-site.
 *
 * The accepted shape is a relative path on this same origin: starts
 * with a single `/`, never starts with `//` (protocol-relative URL),
 * never embeds a scheme-like prefix (`http:`, `javascript:`, `data:`,
 * etc). Anything else collapses to the inbox default.
 */
function sanitiseRedirectTo(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  if (raw.length === 0 || raw.length > 2048) return undefined;
  // Must be a relative same-origin path.
  if (!raw.startsWith('/')) return undefined;
  // `//foo` and `/\foo` are protocol-relative URLs in some browsers.
  if (raw.startsWith('//') || raw.startsWith('/\\')) return undefined;
  // Catch any embedded scheme like `/javascript:` (rare) or accidental
  // double-slashes after URL decoding.
  if (/^\/+[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return undefined;
  // Cheap defence-in-depth: reject any whitespace / control chars.
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

