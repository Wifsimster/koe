import type { BrowserMetadata, TicketKind, TicketPriority, TicketStatus } from '@koe/shared';

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
  limit?: number;
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
  /** Provider so we always read the current token — tokens can rotate
   *  at runtime without recreating the client. */
  getToken: () => string | null;
}

export class AdminApiClient {
  constructor(private readonly opts: AdminApiClientOptions) {}

  me(): Promise<Me> {
    return this.get<Me>('/me');
  }

  listProjects(): Promise<AdminProject[]> {
    return this.get<AdminProject[]>('/projects');
  }

  listTickets(projectKey: string, query: TicketListQuery = {}): Promise<AdminTicket[]> {
    const params = new URLSearchParams();
    if (query.kind) params.set('kind', query.kind);
    if (query.status) params.set('status', query.status);
    if (query.limit) params.set('limit', String(query.limit));
    const qs = params.toString();
    return this.get<AdminTicket[]>(
      `/projects/${encodeURIComponent(projectKey)}/tickets${qs ? `?${qs}` : ''}`,
    );
  }

  private async get<T>(path: string): Promise<T> {
    const token = this.opts.getToken();
    const res = await fetch(this.opts.baseUrl + path, {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
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
