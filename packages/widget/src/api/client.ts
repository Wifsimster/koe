import type {
  ApiResponse,
  BugReport,
  CreateBugReportInput,
  CreateFeatureRequestInput,
  FeatureRequest,
} from '@koe/shared';

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

  async submitBugReport(input: CreateBugReportInput): Promise<BugReport> {
    return this.post<BugReport>('/v1/widget/bugs', input);
  }

  async submitFeatureRequest(input: CreateFeatureRequestInput): Promise<FeatureRequest> {
    return this.post<FeatureRequest>('/v1/widget/features', input);
  }

  async listFeatureRequests(userId?: string): Promise<FeatureRequest[]> {
    const qs = userId ? `?userId=${encodeURIComponent(userId)}` : '';
    return this.get<FeatureRequest[]>(`/v1/widget/features${qs}`);
  }

  async voteFeature(id: string, userId: string): Promise<FeatureRequest> {
    return this.post<FeatureRequest>(`/v1/widget/features/${id}/vote`, { userId });
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(this.apiUrl + path, {
      method: 'GET',
      headers: this.headers(),
      // Identity travels in explicit headers only. `omit` prevents host
      // cookies from leaking to the Koe API and, more importantly, keeps
      // host fetch wrappers (Sentry, Datadog RUM) that inspect
      // credentialed requests from recording the identity header in
      // breadcrumbs.
      credentials: 'omit',
    });
    return this.unwrap<T>(res);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(this.apiUrl + path, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      credentials: 'omit',
    });
    return this.unwrap<T>(res);
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
    let payload: ApiResponse<T>;
    try {
      payload = (await res.json()) as ApiResponse<T>;
    } catch {
      throw new Error(`Koe API returned non-JSON response (status ${res.status})`);
    }
    if (!payload.ok) {
      throw new KoeApiError(payload.error.code, payload.error.message);
    }
    return payload.data;
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
