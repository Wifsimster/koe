import type { BrowserMetadata, TicketKind, TicketPriority, TicketStatus } from '@koe/shared';

export interface TicketPatch {
  status?: TicketStatus;
  priority?: TicketPriority;
}

/**
 * Admin dashboard → `/v1/admin/*` HTTP client. Thin on purpose: the
 * surface is read-only today, mutations join when the triage UI needs
 * them. Throws `AdminApiError` on any non-2xx so callers can branch on
 * `.status === 401` to trigger a re-auth.
 */

export interface Me {
  user: { id: string; email: string; displayName: string | null };
  memberships: Membership[];
}

export interface Membership {
  projectId: string;
  projectKey: string;
  projectName: string;
  role: 'owner' | 'member' | 'viewer';
}

export interface AdminProject {
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
 * Flat ticket shape returned by `/v1/admin/projects/:key/tickets`. This
 * mirrors the DB row (see `packages/api/src/db/schema.ts`) — reporter
 * fields are top-level (`reporterId`, `reporterEmail`, …), not nested
 * like the widget-facing `@koe/shared` Ticket type. Keep them distinct
 * on purpose: the admin surface has full reporter detail where the
 * widget only carries the user-identifying subset.
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
  voteCount: number;
}

export interface TicketListQuery {
  kind?: TicketKind;
  status?: TicketStatus;
  priority?: TicketPriority;
  verified?: boolean;
  search?: string;
  limit?: number;
  cursor?: string;
}

export interface TicketListPage {
  items: AdminTicket[];
  pageInfo: {
    nextCursor: string | null;
    hasMore: boolean;
    limit: number;
  };
}

/**
 * Overview counters for the project landing page. Mirrors the shape
 * returned by `GET /v1/admin/projects/:key/overview` — the aggregate
 * query lives server-side so the dashboard only pays a single round
 * trip on load.
 */
export interface ProjectOverview {
  openBugs: number;
  openFeatures: number;
  criticalOpenBugs: number;
  resolvedLast14d: number;
  openedLast14d: number;
  topVotedThisWeek: AdminTicket[];
  recent: AdminTicket[];
}

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export class AdminApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}

export interface AdminApiClientOptions {
  baseUrl: string;
  /**
   * Optional fallback token. Used when the dashboard runs in
   * dev-session mode (the paste-from-CLI flow). In OIDC mode the
   * browser carries the session in a same-origin cookie and this
   * stays null — `credentials: 'include'` on every request lets the
   * cookie travel without explicit wiring.
   */
  getToken?: () => string | null;
  /**
   * Kick-off URL for the OIDC login flow (`/v1/admin/auth/login`).
   * When set, a 401 response triggers a full-page redirect to this
   * URL with a `redirect_to` param so the user lands back where they
   * were after signing in.
   */
  loginUrl?: string;
  /**
   * POST target that invalidates the server-side session and clears
   * the session cookie. Called by `logout()` in `AuthContext`.
   */
  logoutUrl?: string;
}

export class AdminApiClient {
  constructor(private readonly opts: AdminApiClientOptions) {}

  me(): Promise<Me> {
    return this.get<Me>('/me');
  }

  listProjects(): Promise<AdminProject[]> {
    return this.get<AdminProject[]>('/projects');
  }

  /**
   * Paged ticket list. Filter by kind/status/priority/verified plus a
   * free-text search over title and description. The response carries
   * `pageInfo.nextCursor` — pass it back as `cursor` to fetch the next
   * page. Cursors are opaque; treat them as strings.
   */
  listTickets(
    projectKey: string,
    query: TicketListQuery = {},
  ): Promise<TicketListPage> {
    const params = new URLSearchParams();
    if (query.kind) params.set('kind', query.kind);
    if (query.status) params.set('status', query.status);
    if (query.priority) params.set('priority', query.priority);
    if (query.verified !== undefined) params.set('verified', String(query.verified));
    if (query.search) params.set('search', query.search);
    if (query.limit) params.set('limit', String(query.limit));
    if (query.cursor) params.set('cursor', query.cursor);
    const qs = params.toString();
    return this.get<TicketListPage>(
      `/projects/${encodeURIComponent(projectKey)}/tickets${qs ? `?${qs}` : ''}`,
    );
  }

  /**
   * One-call snapshot for the project home page: open counts, 14-day
   * throughput, top-voted features this week, and the most recent
   * tickets. All scoped to the caller's membership.
   */
  overview(projectKey: string): Promise<ProjectOverview> {
    return this.get<ProjectOverview>(`/projects/${encodeURIComponent(projectKey)}/overview`);
  }

  /**
   * Partial update of a ticket's status / priority. Returns the full
   * updated row so callers can swap in the new state without a
   * refetch. Viewers get a 404 (same as non-members) — the dashboard
   * hides the controls for them, so this is defense-in-depth.
   */
  updateTicket(
    projectKey: string,
    id: string,
    patch: TicketPatch,
  ): Promise<AdminTicket> {
    return this.send<AdminTicket>(
      'PATCH',
      `/projects/${encodeURIComponent(projectKey)}/tickets/${encodeURIComponent(id)}`,
      patch,
    );
  }

  /**
   * Full-page redirect to the OIDC login URL if configured, else
   * no-op. Called after a 401 on any call.
   */
  redirectToLogin(returnTo?: string): void {
    if (!this.opts.loginUrl) return;
    const target = new URL(this.opts.loginUrl, window.location.origin);
    if (returnTo) target.searchParams.set('redirect_to', returnTo);
    window.location.assign(target.toString());
  }

  async logout(): Promise<void> {
    if (!this.opts.logoutUrl) return;
    await fetch(new URL(this.opts.logoutUrl, this.opts.baseUrl).toString(), {
      method: 'POST',
      credentials: 'include',
    }).catch(() => {
      // Logout must not throw — even if the server call fails, the
      // client-side state is cleared by the caller.
    });
  }

  private get<T>(path: string): Promise<T> {
    return this.send<T>('GET', path);
  }

  private async send<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = this.opts.getToken?.() ?? null;
    const res = await fetch(this.opts.baseUrl + path, {
      method,
      // `include` sends cross-origin cookies when the API and
      // dashboard are on different origins. For same-origin deploys
      // it's a no-op but harmless.
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let payload: Envelope<T>;
    try {
      payload = (await res.json()) as Envelope<T>;
    } catch {
      throw new AdminApiError(res.status, 'malformed_response', `Non-JSON from ${path}`);
    }
    if (!payload.ok) {
      throw new AdminApiError(res.status, payload.error.code, payload.error.message);
    }
    return payload.data;
  }
}
