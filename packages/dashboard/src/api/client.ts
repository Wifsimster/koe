import type { BrowserMetadata, TicketKind, TicketPriority, TicketStatus } from '@koe/shared';

export interface TicketPatch {
  status?: TicketStatus;
  priority?: TicketPriority;
}

export interface BulkUpdateResult {
  updated: number;
  failed: Array<{ id: string; reason: 'not_found' }>;
  /** Audit correlation id for every event the bulk call emitted. */
  batchId: string | null;
}

export interface BatchRevertResult {
  reverted: number;
  skipped: Array<{
    eventId: string;
    reason: 'unrevertable' | 'no_change';
  }>;
}

export interface BatchSummary {
  batchId: string;
  createdAt: string;
  eventCount: number;
  ticketCount: number;
  kinds: string[];
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
   * The server never returns this value again.
   */
  identitySecret: string;
}

export type TicketEventKind = 'status_changed' | 'priority_changed' | 'commented';

export interface TicketEvent {
  id: string;
  ticketId: string;
  kind: TicketEventKind;
  payload: Record<string, unknown>;
  createdAt: string;
  /** Correlation id for events from the same bulk call. `null` for single-ticket. */
  batchId: string | null;
}

export interface TicketComment {
  id: string;
  ticketId: string;
  body: string;
  createdAt: string;
}

export interface Me {
  email: string;
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
}

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

export interface ProjectOverview {
  openBugs: number;
  openFeatures: number;
  criticalOpenBugs: number;
  resolvedLast14d: number;
  openedLast14d: number;
  topVotedThisWeek: AdminTicket[];
  recent: AdminTicket[];
}

export interface WorkspaceProjectKpis {
  openBugs: number;
  openFeatures: number;
  openFeatureVotes: number;
  activityLast7d: number;
  activityPrev7d: number;
}

export interface WorkspaceProjectSummary {
  id: string;
  key: string;
  name: string;
  accentColor: string;
  kpis: WorkspaceProjectKpis;
}

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
}

export class AdminApiClient {
  constructor(private readonly opts: AdminApiClientOptions) {}

  me(): Promise<Me> {
    return this.get<Me>('/me');
  }

  listProjects(): Promise<AdminProject[]> {
    return this.get<AdminProject[]>('/projects');
  }

  workspaceOverview(): Promise<WorkspaceOverview> {
    return this.get<WorkspaceOverview>('/overview');
  }

  listTickets(projectKey: string, query: TicketListQuery = {}): Promise<TicketListPage> {
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

  overview(projectKey: string): Promise<ProjectOverview> {
    return this.get<ProjectOverview>(`/projects/${encodeURIComponent(projectKey)}/overview`);
  }

  updateTicket(projectKey: string, id: string, patch: TicketPatch): Promise<AdminTicket> {
    return this.send<AdminTicket>(
      'PATCH',
      `/projects/${encodeURIComponent(projectKey)}/tickets/${encodeURIComponent(id)}`,
      patch,
    );
  }

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

  revertEventBatch(projectKey: string, batchId: string): Promise<BatchRevertResult> {
    return this.send<BatchRevertResult>(
      'POST',
      `/projects/${encodeURIComponent(projectKey)}/events/batches/${encodeURIComponent(
        batchId,
      )}/revert`,
    );
  }

  listEventBatches(projectKey: string): Promise<BatchSummary[]> {
    return this.get<BatchSummary[]>(
      `/projects/${encodeURIComponent(projectKey)}/events/batches`,
    );
  }

  createProject(payload: CreateProjectPayload): Promise<CreateProjectResult> {
    return this.send<CreateProjectResult>('POST', '/projects', payload);
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

  loginWithPassword(email: string, password: string): Promise<{ email: string }> {
    return this.send<{ email: string }>('POST', '/auth/login', { email, password });
  }

  async logout(): Promise<void> {
    await fetch(this.opts.baseUrl + '/auth/logout', {
      method: 'POST',
      credentials: 'include',
    }).catch(() => {
      // Logout must not throw — the cookie will expire on its own.
    });
  }

  private get<T>(path: string): Promise<T> {
    return this.send<T>('GET', path);
  }

  private async send<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.opts.baseUrl + path, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
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
