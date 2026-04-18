import type { BrowserMetadata, TicketKind, TicketPriority, TicketStatus } from '@koe/shared';

export interface TicketPatch {
  status?: TicketStatus;
  priority?: TicketPriority;
  /**
   * Ticket assignee. `string` = set, `null` = explicit unassign,
   * `undefined` (key absent) = no change. The wire shape matches
   * the Zod `.nullable().optional()` on the server.
   */
  assignedToUserId?: string | null;
}

export interface BulkUpdateResult {
  updated: number;
  failed: Array<{ id: string; reason: 'not_found' }>;
  /**
   * Shared audit correlation id for every event the bulk call
   * emitted. `null` when the patch was a no-op against every
   * matched ticket. Clients can pass this back to the batch-revert
   * endpoint to undo the whole thing.
   */
  batchId: string | null;
}

export interface BatchRevertResult {
  reverted: number;
  skipped: Array<{
    eventId: string;
    reason: 'unrevertable' | 'no_change' | 'assignee_gone';
  }>;
}

/**
 * Summary row for the recent bulk actions panel. Mirrors the shape
 * returned by `GET /v1/admin/projects/:key/events/batches` — the
 * dashboard can surface a batch without opening every ticket it
 * touched.
 */
export interface BatchSummary {
  batchId: string;
  createdAt: string;
  actorUserId: string | null;
  actorEmail: string | null;
  actorDisplayName: string | null;
  eventCount: number;
  ticketCount: number;
  kinds: string[];
}

export interface ProjectMember {
  userId: string;
  email: string;
  displayName: string | null;
  role: 'owner' | 'member' | 'viewer';
}

export interface CreateProjectPayload {
  name: string;
  key: string;
  allowedOrigins?: string[];
  requireIdentityVerification?: boolean;
}

export interface CreateProjectResult {
  project: AdminProject;
  /**
   * Plaintext HMAC secret the caller must show to the operator once.
   * The server never returns this value again (the DB stores an
   * encrypted envelope).
   */
  identitySecret: string;
}

export interface InviteMemberPayload {
  email: string;
  role: ProjectMember['role'];
  displayName?: string;
  /**
   * Required when the email doesn't match an existing admin user.
   * argon2id-hashed server-side. At least 12 chars.
   */
  initialPassword?: string;
}

export type TicketEventKind =
  | 'status_changed'
  | 'priority_changed'
  | 'assigned'
  | 'commented';

export interface TicketEvent {
  id: string;
  ticketId: string;
  kind: TicketEventKind;
  payload: Record<string, unknown>;
  createdAt: string;
  actorUserId: string | null;
  actorEmail: string | null;
  /**
   * Correlation id for events emitted from the same bulk call.
   * `null` for single-ticket mutations. Lets the dashboard offer a
   * single "Undo batch" action next to any event that came from a
   * bulk apply.
   */
  batchId: string | null;
}

export interface TicketComment {
  id: string;
  ticketId: string;
  body: string;
  createdAt: string;
  authorUserId: string | null;
  authorEmail: string | null;
  authorDisplayName: string | null;
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
  assignedToUserId: string | null;
  /**
   * Pre-joined from `admin_users` by the list/patch endpoints so the
   * inbox card can show who's on the ticket without a second
   * round-trip. `null` when unassigned.
   */
  assignedToEmail: string | null;
  assignedToDisplayName: string | null;
  stepsToReproduce: string | null;
  expectedBehavior: string | null;
  actualBehavior: string | null;
  metadata: BrowserMetadata | null;
  screenshotUrl: string | null;
  createdAt: string;
  updatedAt: string;
  voteCount: number;
}

export type AssigneeFilter = 'me' | 'unassigned' | string;

export interface TicketListQuery {
  kind?: TicketKind;
  status?: TicketStatus;
  priority?: TicketPriority;
  verified?: boolean;
  search?: string;
  /**
   * Assignee filter. `me` / `unassigned` are server-side shortcuts;
   * any other string is treated as a user uuid. Maps 1:1 to the API
   * `?assignee=` query param so URLs stay shareable.
   */
  assignee?: AssigneeFilter;
  /**
   * Sort order. `recent` (default) orders by `updated_at` desc.
   * `votes` orders by vote count desc and is incompatible with
   * `cursor` (server returns 422).
   */
  sort?: 'recent' | 'votes';
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
 * KPI tile for one project on the cross-project overview. All
 * counters are pre-aggregated server-side; the dashboard just
 * renders them.
 */
export interface WorkspaceProjectKpis {
  openBugs: number;
  openFeatures: number;
  openFeatureVotes: number;
}

export interface WorkspaceProjectSummary {
  id: string;
  key: string;
  name: string;
  accentColor: string;
  kpis: WorkspaceProjectKpis;
}

/**
 * Response for `GET /v1/admin/overview` — one tile per project the
 * signed-in admin belongs to. Ordered by project name.
 */
export interface WorkspaceOverview {
  projects: WorkspaceProjectSummary[];
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
   * One-call KPI snapshot across every project the admin belongs to.
   * Powers the `/overview` landing page for multi-project admins.
   */
  workspaceOverview(): Promise<WorkspaceOverview> {
    return this.get<WorkspaceOverview>('/overview');
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
    if (query.assignee) params.set('assignee', query.assignee);
    if (query.sort && query.sort !== 'recent') params.set('sort', query.sort);
    if (query.limit) params.set('limit', String(query.limit));
    if (query.cursor) params.set('cursor', query.cursor);
    const qs = params.toString();
    return this.get<TicketListPage>(
      `/projects/${encodeURIComponent(projectKey)}/tickets${qs ? `?${qs}` : ''}`,
    );
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
   * Apply one patch to up to 100 tickets at once. Returns a summary —
   * the dashboard refetches the list to pick up the new state rather
   * than trying to reconcile per-row.
   */
  bulkUpdateTickets(
    projectKey: string,
    ids: string[],
    patch: TicketPatch,
  ): Promise<BulkUpdateResult> {
    return this.send<BulkUpdateResult>(
      'POST',
      `/projects/${encodeURIComponent(projectKey)}/tickets/bulk`,
      { ids, patch },
    );
  }

  listTicketEvents(projectKey: string, id: string): Promise<TicketEvent[]> {
    return this.get<TicketEvent[]>(
      `/projects/${encodeURIComponent(projectKey)}/tickets/${encodeURIComponent(id)}/events`,
    );
  }

  /**
   * Revert a single audit event. Returns the updated ticket, same
   * shape as `listTickets` / `updateTicket`. Only
   * status / priority / assigned events are revertable — the
   * server returns 422 for a comment or a malformed payload.
   */
  revertTicketEvent(
    projectKey: string,
    ticketId: string,
    eventId: string,
  ): Promise<AdminTicket> {
    return this.send<AdminTicket>(
      'POST',
      `/projects/${encodeURIComponent(projectKey)}/tickets/${encodeURIComponent(
        ticketId,
      )}/events/${encodeURIComponent(eventId)}/revert`,
    );
  }

  /**
   * Revert every event sharing a bulk-action `batchId`. Skipped
   * events are returned with a reason — the dashboard can surface
   * the count ("12 reverted, 2 skipped").
   */
  revertEventBatch(
    projectKey: string,
    batchId: string,
  ): Promise<BatchRevertResult> {
    return this.send<BatchRevertResult>(
      'POST',
      `/projects/${encodeURIComponent(projectKey)}/events/batches/${encodeURIComponent(
        batchId,
      )}/revert`,
    );
  }

  /**
   * Project-wide list of recent bulk actions. Sorted newest-first
   * by creation time. Server caps at 50 rows.
   */
  listEventBatches(projectKey: string): Promise<BatchSummary[]> {
    return this.get<BatchSummary[]>(
      `/projects/${encodeURIComponent(projectKey)}/events/batches`,
    );
  }

  listProjectMembers(projectKey: string): Promise<ProjectMember[]> {
    return this.get<ProjectMember[]>(
      `/projects/${encodeURIComponent(projectKey)}/members`,
    );
  }

  /**
   * Create a new project + grant the caller `owner` membership. The
   * response carries the plaintext `identitySecret` once — callers
   * must surface it to the operator immediately; the server never
   * returns it again.
   */
  createProject(payload: CreateProjectPayload): Promise<CreateProjectResult> {
    return this.send<CreateProjectResult>('POST', '/projects', payload);
  }

  /**
   * Invite a user to a project. Behaviour per caller scenario:
   *   - email matches an existing admin → the user gains membership,
   *     no password change.
   *   - email is new → caller must pass `initialPassword`; server
   *     provisions the admin_users row with an argon2id hash.
   */
  inviteProjectMember(
    projectKey: string,
    payload: InviteMemberPayload,
  ): Promise<ProjectMember> {
    return this.send<ProjectMember>(
      'POST',
      `/projects/${encodeURIComponent(projectKey)}/members`,
      payload,
    );
  }

  updateProjectMember(
    projectKey: string,
    userId: string,
    role: ProjectMember['role'],
  ): Promise<ProjectMember> {
    return this.send<ProjectMember>(
      'PATCH',
      `/projects/${encodeURIComponent(projectKey)}/members/${encodeURIComponent(userId)}`,
      { role },
    );
  }

  removeProjectMember(projectKey: string, userId: string): Promise<{ ok: true }> {
    return this.send<{ ok: true }>(
      'DELETE',
      `/projects/${encodeURIComponent(projectKey)}/members/${encodeURIComponent(userId)}`,
    );
  }

  listTicketComments(projectKey: string, id: string): Promise<TicketComment[]> {
    return this.get<TicketComment[]>(
      `/projects/${encodeURIComponent(projectKey)}/tickets/${encodeURIComponent(id)}/comments`,
    );
  }

  createTicketComment(
    projectKey: string,
    id: string,
    body: string,
  ): Promise<TicketComment> {
    return this.send<TicketComment>(
      'POST',
      `/projects/${encodeURIComponent(projectKey)}/tickets/${encodeURIComponent(id)}/comments`,
      { body },
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

  /**
   * Email + password login. Used when the API runs in
   * `ADMIN_AUTH_MODE=password`. On success the server sets the same
   * `koe_admin` session cookie the OIDC callback sets, so subsequent
   * calls carry the session implicitly via `credentials: 'include'`.
   */
  loginWithPassword(email: string, password: string): Promise<{ user: Me['user'] }> {
    return this.send<{ user: Me['user'] }>('POST', '/auth/password', { email, password });
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
