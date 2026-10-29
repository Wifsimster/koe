import type { AdminTicket, ApiResponse, TicketKind, TicketPriority, TicketStatus } from '@koe/shared';

export type { AdminTicket };

export interface TicketPatch {
  status?: TicketStatus;
  priority?: TicketPriority;
  notes?: string | null;
  isPublicRoadmap?: boolean;
}

export interface BulkUpdateResult {
  updated: number;
  failed: Array<{ id: string; reason: 'not_found' }>;
}

export interface CreateProjectPayload {
  name: string;
  key: string;
  allowedOrigins?: string[];
  requireIdentityVerification?: boolean;
}

export interface CreateProjectResult {
  project: AdminProject;
  identitySecret: string;
}

export type TicketEventKind = 'status_changed' | 'priority_changed' | 'roadmap_toggled';

export interface TicketEvent {
  id: string;
  ticketId: string;
  kind: TicketEventKind;
  payload: Record<string, unknown>;
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

export interface TicketListQuery {
  kind?: TicketKind;
  status?: TicketStatus;
  priority?: TicketPriority;
  verified?: boolean;
  search?: string;
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

export interface WorkspaceOverview {
  projects: WorkspaceProjectSummary[];
}

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

  workspaceOverview(signal?: AbortSignal): Promise<WorkspaceOverview> {
    return this.get<WorkspaceOverview>('/overview', signal);
  }

  listTickets(
    projectKey: string,
    query: TicketListQuery = {},
    signal?: AbortSignal,
  ): Promise<TicketListPage> {
    const params = new URLSearchParams();
    if (query.kind) params.set('kind', query.kind);
    if (query.status) params.set('status', query.status);
    if (query.priority) params.set('priority', query.priority);
    if (query.verified !== undefined) params.set('verified', String(query.verified));
    if (query.search) params.set('search', query.search);
    if (query.sort && query.sort !== 'recent') params.set('sort', query.sort);
    if (query.limit) params.set('limit', String(query.limit));
    if (query.cursor) params.set('cursor', query.cursor);
    const qs = params.toString();
    return this.get<TicketListPage>(
      `/projects/${encodeURIComponent(projectKey)}/tickets${qs ? `?${qs}` : ''}`,
      signal,
    );
  }

  getTicket(projectKey: string, id: string, signal?: AbortSignal): Promise<AdminTicket> {
    return this.get<AdminTicket>(
      `/projects/${encodeURIComponent(projectKey)}/tickets/${encodeURIComponent(id)}`,
      signal,
    );
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

  createProject(payload: CreateProjectPayload): Promise<CreateProjectResult> {
    return this.send<CreateProjectResult>('POST', '/projects', payload);
  }

  loginWithPassword(email: string, password: string): Promise<{ email: string }> {
    return this.send<{ email: string }>('POST', '/auth/login', { email, password });
  }

  async logout(): Promise<void> {
    await fetch(this.opts.baseUrl + '/auth/logout', {
      method: 'POST',
      credentials: 'include',
    }).catch(() => {
    });
  }

  private get<T>(path: string, signal?: AbortSignal): Promise<T> {
    return this.send<T>('GET', path, undefined, signal);
  }

  private async send<T>(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.opts.baseUrl + path, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      const message =
        err instanceof Error && err.message ? err.message : `Network error talking to ${path}`;
      throw new AdminApiError(0, 'network_error', message);
    }

    if (res.status === 204) {
      return null as T;
    }

    const text = await res.text();
    if (text.length === 0) {
      if (res.ok) return null as T;
      throw new AdminApiError(
        res.status,
        res.status >= 500 ? 'server_error' : 'http_error',
        `Empty response (${res.status}) from ${path}`,
      );
    }

    let payload: ApiResponse<T>;
    try {
      payload = JSON.parse(text) as ApiResponse<T>;
    } catch {
      const code = res.status >= 500 ? 'server_error' : 'malformed_response';
      throw new AdminApiError(res.status, code, `Non-JSON from ${path}`);
    }
    if (!payload.ok) {
      throw new AdminApiError(res.status, payload.error.code, payload.error.message);
    }
    return payload.data;
  }
}
