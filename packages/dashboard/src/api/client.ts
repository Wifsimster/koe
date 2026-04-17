import {
  KoeHttpClient,
  KoeApiError,
  type BrowserMetadata,
  type TicketKind,
  type TicketStatus,
  type TicketPriority,
} from '@koe/shared';

export { KoeApiError };

/**
 * Session token storage. We keep it in `localStorage` for the dev
 * session scheme — it survives reloads and keeps the auth contract
 * visible for local testing. When we cut over to cookie sessions
 * (better-auth or OIDC), this helper goes away; the transport switches
 * `credentials()` to `'include'` and the browser manages the cookie.
 */
const TOKEN_KEY = 'koe.admin.token';

export const tokenStore = {
  get(): string | null {
    try {
      return typeof window === 'undefined' ? null : window.localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string) {
    try {
      window.localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* Private-mode Safari etc. — the in-memory client still works
         for the session, the operator just re-enters the token next
         time. Don't surface an error. */
    }
  },
  clear() {
    try {
      window.localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

export interface AdminUser {
  id: string;
  email: string;
  displayName: string | null;
}

export interface AdminMembership {
  projectId: string;
  projectKey: string;
  projectName: string;
  role: 'owner' | 'member' | 'viewer';
}

export interface AdminMe {
  user: AdminUser;
  memberships: AdminMembership[];
}

export interface AdminProjectSummary {
  id: string;
  key: string;
  name: string;
  accentColor: string;
  allowedOrigins: string[];
  requireIdentityVerification: boolean;
  lastPingAt: string | null;
  lastPingOrigin: string | null;
  createdAt: string;
  role: 'owner' | 'member' | 'viewer';
}

/**
 * Shape of a ticket row as returned by the admin API. Deliberately
 * flatter than `@koe/shared#Ticket` (which discriminates on `kind`),
 * because the admin view needs every column regardless of kind and
 * the server ships the raw row with bug-only columns nullable.
 */
export interface AdminTicket {
  id: string;
  projectId: string;
  kind: TicketKind;
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  reporterId: string;
  reporterName: string | null;
  reporterEmail: string | null;
  reporterVerified: boolean;
  stepsToReproduce: string | null;
  expectedBehavior: string | null;
  actualBehavior: string | null;
  metadata: BrowserMetadata | null;
  screenshotUrl: string | null;
  createdAt: string;
  updatedAt: string;
  voteCount?: number;
}

export interface Page<T> {
  items: T[];
  pageInfo: {
    nextCursor: string | null;
    hasMore: boolean;
    limit: number;
  };
}

export interface TicketListQuery {
  kind?: 'bug' | 'feature';
  status?: TicketStatus;
  priority?: TicketPriority;
  verified?: boolean;
  search?: string;
  cursor?: string;
  limit?: number;
}

export interface Overview {
  openBugs: number;
  openFeatures: number;
  criticalOpenBugs: number;
  resolvedLast14d: number;
  openedLast14d: number;
  topVotedThisWeek: AdminTicket[];
  recent: AdminTicket[];
}

/**
 * Admin-scoped transport. Auth is a bearer token today; swap to
 * credentials-including cookies when session auth lands.
 */
export class KoeAdminClient extends KoeHttpClient {
  private token: string | null;

  constructor(opts: { apiUrl: string; token: string | null }) {
    super(opts.apiUrl);
    this.token = opts.token;
  }

  setToken(token: string | null) {
    this.token = token;
  }

  protected defaultHeaders(): Record<string, string> {
    if (!this.token) return {};
    return { Authorization: `Bearer ${this.token}` };
  }

  me() {
    return this.request<AdminMe>({ method: 'GET', path: '/v1/admin/me' });
  }

  listProjects() {
    return this.request<AdminProjectSummary[]>({ method: 'GET', path: '/v1/admin/projects' });
  }

  listTickets(projectKey: string, query: TicketListQuery = {}) {
    return this.request<Page<AdminTicket>>({
      method: 'GET',
      path: `/v1/admin/projects/${encodeURIComponent(projectKey)}/tickets`,
      query: {
        kind: query.kind,
        status: query.status,
        priority: query.priority,
        verified: query.verified === undefined ? undefined : String(query.verified),
        search: query.search,
        cursor: query.cursor,
        limit: query.limit,
      },
    });
  }

  overview(projectKey: string) {
    return this.request<Overview>({
      method: 'GET',
      path: `/v1/admin/projects/${encodeURIComponent(projectKey)}/overview`,
    });
  }

  patchTicket(id: string, patch: { status?: TicketStatus; priority?: TicketPriority }) {
    return this.request<AdminTicket>({
      method: 'PATCH',
      path: `/v1/admin/tickets/${encodeURIComponent(id)}`,
      body: patch,
    });
  }
}

/**
 * A client pointed at the right origin for the current deployment. In
 * same-origin (served by Hono at `/admin/`), `''` means "relative to
 * the current origin" so the browser's same-origin policy protects us
 * without any CORS headers on the API side.
 */
export function createAdminClient(): KoeAdminClient {
  const baseUrl = import.meta.env.VITE_KOE_API_URL ?? '';
  return new KoeAdminClient({ apiUrl: baseUrl, token: tokenStore.get() });
}
