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

export interface LoginSearch {
  redirectTo?: string;
}

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

/**
 * Catch-all for unknown routes. Without it, an unrecognised URL would
 * render the route's empty children — i.e. a blank page — instead of
 * something the operator can act on.
 */
export function NotFoundView(): ReactNode {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background p-6 text-center">
      <div className="text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
        Kōe · 404
      </div>
      <h1 className="font-heading text-3xl tracking-tight">Page not found</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        That URL doesn't match anything in the dashboard.
      </p>
      <a
        href="/"
        className="text-sm underline underline-offset-4 hover:text-foreground"
      >
        Back to inbox
      </a>
    </div>
  );
}

/**
 * Top-level boundary for thrown loaders / route components. Without
 * one, a thrown route loader would surface as a blank screen.
 */
export function RouteErrorView({ error }: { error?: unknown }): ReactNode {
  const message =
    error instanceof Error && error.message
      ? error.message
      : 'Something went wrong. Try reloading.';
  return (
    <div className="flex min-h-[40vh] flex-col items-start justify-center gap-3 p-6">
      <div className="text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
        Kōe · Error
      </div>
      <h2 className="font-heading text-2xl tracking-tight">Couldn't load this page</h2>
      <p
        role="alert"
        className="max-w-prose border-l-2 border-destructive/70 bg-destructive/5 px-4 py-3 text-sm text-destructive"
      >
        {message}
      </p>
    </div>
  );
}
