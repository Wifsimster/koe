import type {
  BugReport,
  CreateBugReportInput,
  CreateFeatureRequestInput,
  FeatureRequest,
  MyRequestRow,
} from '@koe/shared';
import { z } from 'zod';

const envelopeSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string() }),
  }),
]);

export interface RequestOptions {
  signal?: AbortSignal;
}

export interface KoeApiClientOptions {
  apiUrl: string;
  projectKey: string;
  /** @deprecated Prefer `identityToken` — v1 hashes have no TTL, no nonce, and no rotation story. v1 remains supported for backward compatibility with existing integrations. */
  userHash?: string;
  identityToken?: string;
}

export class KoeApiClient {
  private readonly apiUrl: string;
  private readonly projectKey: string;
  private readonly userHash: string | undefined;
  private readonly identityToken: string | undefined;

  constructor(opts: KoeApiClientOptions) {
    this.apiUrl = opts.apiUrl.replace(/\/$/, '');
    this.projectKey = opts.projectKey;
    this.userHash = opts.userHash;
    this.identityToken = opts.identityToken;
  }

  async submitBugReport(
    input: CreateBugReportInput,
    opts: RequestOptions = {},
  ): Promise<BugReport> {
    return this.post<BugReport>('/v1/widget/bugs', input, opts.signal);
  }

  async submitFeatureRequest(
    input: CreateFeatureRequestInput,
    opts: RequestOptions = {},
  ): Promise<FeatureRequest> {
    return this.post<FeatureRequest>('/v1/widget/features', input, opts.signal);
  }

  async listFeatureRequests(userId?: string, opts: RequestOptions = {}): Promise<FeatureRequest[]> {
    const qs = userId ? `?userId=${encodeURIComponent(userId)}` : '';
    return this.get<FeatureRequest[]>(`/v1/widget/features${qs}`, opts.signal);
  }

  async voteFeature(
    id: string,
    userId: string,
    opts: RequestOptions = {},
  ): Promise<FeatureRequest> {
    return this.post<FeatureRequest>(`/v1/widget/features/${id}/vote`, { userId }, opts.signal);
  }

  async listMyRequests(
    userId: string,
    opts: RequestOptions = {},
  ): Promise<MyRequestRow[]> {
    const qs = `?userId=${encodeURIComponent(userId)}`;
    return this.get<MyRequestRow[]>(`/v1/widget/my-requests${qs}`, opts.signal);
  }

  roadmapUrl(ticketId?: string): string {
    const base = `${this.apiUrl}/r/${encodeURIComponent(this.projectKey)}`;
    return ticketId ? `${base}#t-${encodeURIComponent(ticketId)}` : base;
  }

  private async get<T>(path: string, signal?: AbortSignal): Promise<T> {
    const res = await this.fetchSafe(this.apiUrl + path, {
      method: 'GET',
      headers: this.headers(),
      credentials: 'omit',
      signal,
    });
    return this.unwrap<T>(res);
  }

  private async post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const res = await this.fetchSafe(this.apiUrl + path, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      credentials: 'omit',
      signal,
    });
    return this.unwrap<T>(res);
  }

  private async fetchSafe(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, init);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      const message = err instanceof Error ? err.message : 'Network request failed';
      throw new KoeApiError('network_error', message);
    }
  }

  private headers(): HeadersInit {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Koe-Project-Key': this.projectKey,
    };
    if (this.identityToken) {
      headers['X-Koe-Identity-Token'] = this.identityToken;
    } else if (this.userHash) {
      headers['X-Koe-User-Hash'] = this.userHash;
    }
    return headers;
  }

  private async unwrap<T>(res: Response): Promise<T> {
    let raw: unknown;
    let parseFailed = false;
    try {
      raw = await res.json();
    } catch {
      parseFailed = true;
    }
    if (parseFailed) {
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('Retry-After') ?? '0', 10);
        throw new KoeApiError(
          'rate_limited',
          'Too many requests — please wait a moment and try again.',
          { retryAfter: Number.isFinite(retryAfter) ? retryAfter : 0 },
        );
      }
      if (res.status === 401 || res.status === 403) {
        throw new KoeApiError('unauthorized', 'You are not authorized to make this request.');
      }
      if (res.status >= 500) {
        throw new KoeApiError(
          'server_error',
          `Koe API server error (status ${res.status}${res.statusText ? ` ${res.statusText}` : ''}).`,
        );
      }
      throw new KoeApiError(
        'invalid_response',
        `Koe API returned non-JSON response (status ${res.status}${res.statusText ? ` ${res.statusText}` : ''})`,
      );
    }
    const parsed = envelopeSchema.safeParse(raw);
    if (!parsed.success) {
      throw new KoeApiError('invalid_response', 'Koe API returned an unexpected envelope shape');
    }
    const payload = parsed.data;
    if (!payload.ok) {
      throw new KoeApiError(payload.error.code, payload.error.message);
    }
    return payload.data as T;
  }
}

export interface KoeApiErrorDetail {
  retryAfter?: number;
}

export class KoeApiError extends Error {
  public readonly detail: KoeApiErrorDetail;
  constructor(
    public readonly code: string,
    message: string,
    detail: KoeApiErrorDetail = {},
  ) {
    super(message);
    this.name = 'KoeApiError';
    this.detail = detail;
  }
}
