import { useEffect, type ReactNode } from 'react';
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
import { AppShell } from './components/AppShell';
import { useAuth, type AuthContextValue } from './auth/AuthContext';
import type { AssigneeFilter } from './api/client';

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

/**
 * Search-param contract for the inbox. Survives refresh, is
 * shareable, and lets the back/forward buttons work on filter
 * changes. All fields default to the "show everything interesting"
 * starting view so a clean URL (`/`) is never empty.
 *
 * Unknown values coerce to defaults rather than throwing — a
 * clipboard'd URL from an older version still opens.
 */
export interface InboxSearch {
  kind: TicketKind | 'all';
  status: TicketStatus | 'all';
  assignee: AssigneeFilter | 'all';
  /** Free-text query matched server-side against title, description,
   *  reporter email, and assignee email. Empty string ≡ unset. */
  q: string;
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
const ASSIGNEE_SHORTCUTS: ReadonlySet<string> = new Set(['all', 'me', 'unassigned']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
function parseAssignee(raw: unknown): InboxSearch['assignee'] {
  if (typeof raw !== 'string') return 'all';
  if (ASSIGNEE_SHORTCUTS.has(raw)) return raw as InboxSearch['assignee'];
  return UUID_RE.test(raw) ? raw : 'all';
}

const inboxRoute = createRoute({
  getParentRoute: () => authenticatedLayoutRoute,
  path: '/',
  component: InboxPage,
  validateSearch: (raw: Record<string, unknown>): InboxSearch => ({
    kind: parseKind(raw.kind),
    status: parseStatus(raw.status),
    assignee: parseAssignee(raw.assignee),
    q: typeof raw.q === 'string' ? raw.q.slice(0, 200) : '',
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

export const routeTree = rootRoute.addChildren([
  loginRoute,
  authenticatedLayoutRoute.addChildren([
    inboxRoute,
    ticketDetailRoute,
    batchesRoute,
  ]),
]);

function RootGate() {
  // Top-level outlet. The auth gate lives on the `_authenticated`
  // parent route, so this layer just renders whatever matched.
  return <Outlet />;
}

function AuthenticatedLayout() {
  const { state } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // beforeLoad only runs on navigation, so a mid-session transition
  // from `loading` → `unauthenticated` (e.g. /me returns 401 after
  // the route already matched) would otherwise strand the user on a
  // guarded route. Mirror the beforeLoad redirect here.
  useEffect(() => {
    if (state.status === 'unauthenticated') {
      void navigate({ to: '/login', search: { redirectTo: pathname } });
    }
  }, [state.status, navigate, pathname]);

  if (state.status !== 'authenticated') {
    return <LoadingScreen />;
  }
  return (
    <AppShell header={<RouteHeader />}>
      <Outlet />
    </AppShell>
  );
}

/**
 * Resolves the header copy from the current pathname. A proper
 * implementation would hang it off each route's meta, but two
 * pages is too few to pay for the abstraction.
 */
function RouteHeader(): ReactNode {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname.startsWith('/batches')) {
    return (
      <div>
        <h2 className="text-xl md:text-2xl font-semibold">Recent batches</h2>
        <p className="text-sm text-gray-600">
          Bulk actions your team has run on this project, newest first. Undo a whole batch from
          here if it looks off.
        </p>
      </div>
    );
  }
  if (pathname.startsWith('/tickets/')) {
    return (
      <div>
        <h2 className="text-xl md:text-2xl font-semibold">Ticket</h2>
      </div>
    );
  }
  return (
    <div>
      <h2 className="text-xl md:text-2xl font-semibold">Inbox</h2>
      <p className="text-sm text-gray-600">Triage incoming bug reports and feature requests.</p>
    </div>
  );
}

/**
 * Post-login default search. The router requires the full shape on
 * `<Link to="/">` because `validateSearch` is non-optional; exported
 * so callers don't repeat the defaults.
 */
export const INBOX_DEFAULT_SEARCH: InboxSearch = {
  kind: 'all',
  status: 'open',
  assignee: 'all',
  q: '',
};

function LoadingScreen(): ReactNode {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 text-sm text-gray-500">
      Loading…
    </div>
  );
}
