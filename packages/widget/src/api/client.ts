import type {
  BugReport,
  CreateBugReportInput,
  CreateFeatureRequestInput,
  FeatureRequest,
} from '@koe/shared';
import { z } from 'zod';

/**
 * Validates the API response envelope shape only. The inner `data` payload
 * is left as `unknown` and trusted via the caller's generic — the server
 * is first-party and TypeScript already describes each endpoint's shape
 * through the public client methods. What we guard against here is a
 * malformed or impostor response (reverse proxy error page, captive
 * portal, etc.) slipping past the cast and blowing up downstream.
 *
 * Declared at module scope so the schema is compiled once per bundle,
 * not rebuilt on every request.
 */
const envelopeSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string() }),
  }),
]);

export interface RequestOptions {
  /** Abort the request when the host component unmounts or navigates away. */
  signal?: AbortSignal;
}

export interface KoeApiClientOptions {
  apiUrl: string;
  projectKey: string;
  /**
   * Opaque HMAC of the reporter id signed with the project's identity
   * secret, provided by the host app's backend.
   *
   * @deprecated Prefer `identityToken` — v1 hashes have no TTL, no nonce,
   * and no rotation story. v1 remains supported for backward
   * compatibility with existing integrations.
   */
  userHash?: string;
  /**
   * Signed identity token (v2) minted by the host app's backend. Carries
   * bound claims (`reporterId`, `projectId`, `iat`, `nonce`, `kid`) so a
   * captured token cannot be replayed across sessions or projects, and
   * secrets can be rotated without breaking live integrations.
   *
   * Sent via the `X-Koe-Identity-Token` header. Takes precedence over
   * `userHash` when both are provided.
   */
  identityToken?: string;
}

/**
 * Thin wrapper around fetch for the widget → Koe API. Keeps transport
 * concerns (auth header, base URL, envelope unwrapping) out of components.
 */
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

  private async get<T>(path: string, signal?: AbortSignal): Promise<T> {
    const res = await this.fetchSafe(this.apiUrl + path, {
      method: 'GET',
      headers: this.headers(),
      // Identity travels in explicit headers only. `omit` prevents host
      // cookies from leaking to the Koe API and, more importantly, keeps
      // host fetch wrappers (Sentry, Datadog RUM) that inspect
      // credentialed requests from recording the identity header in
      // breadcrumbs.
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

  // Wrap `fetch` so network failures surface as typed `KoeApiError` with a
  // stable `network_error` code. Host error reporting (Sentry breadcrumbs,
  // analytics) can then filter on the code instead of string-matching the
  // browser's locale-dependent `TypeError: Failed to fetch`. AbortError is
  // re-thrown untouched so callers can detect cancellation via the signal.
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
    // v2 identity token takes precedence. Sending both is redundant and
    // risks confusing host-side ops, so we pick one.
    if (this.identityToken) {
      headers['X-Koe-Identity-Token'] = this.identityToken;
    } else if (this.userHash) {
      headers['X-Koe-User-Hash'] = this.userHash;
    }
    return headers;
  }

  private async unwrap<T>(res: Response): Promise<T> {
    let raw: unknown;
    try {
      raw = await res.json();
    } catch {
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

export class KoeApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'KoeApiError';
  }
}
