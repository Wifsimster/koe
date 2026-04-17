import {
  KoeHttpClient,
  KoeApiError,
  type BugReport,
  type CreateBugReportInput,
  type CreateFeatureRequestInput,
  type FeatureRequest,
} from '@koe/shared';

// Re-export so existing widget code keeps its public surface unchanged.
export { KoeApiError };

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
 * Widget → Koe API. Thin typed wrapper on top of the shared
 * `KoeHttpClient` transport. Owns only widget-specific concerns: the
 * project key header, the optional identity header selection, and the
 * four widget endpoints.
 */
export class KoeApiClient extends KoeHttpClient {
  private readonly projectKey: string;
  private readonly userHash: string | undefined;
  private readonly identityToken: string | undefined;

  constructor(opts: KoeApiClientOptions) {
    super(opts.apiUrl);
    this.projectKey = opts.projectKey;
    this.userHash = opts.userHash;
    this.identityToken = opts.identityToken;
  }

  protected defaultHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
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

  async submitBugReport(input: CreateBugReportInput): Promise<BugReport> {
    return this.request<BugReport>({ method: 'POST', path: '/v1/widget/bugs', body: input });
  }

  async submitFeatureRequest(input: CreateFeatureRequestInput): Promise<FeatureRequest> {
    return this.request<FeatureRequest>({
      method: 'POST',
      path: '/v1/widget/features',
      body: input,
    });
  }

  async listFeatureRequests(userId?: string): Promise<FeatureRequest[]> {
    return this.request<FeatureRequest[]>({
      method: 'GET',
      path: '/v1/widget/features',
      query: { userId },
    });
  }

  async voteFeature(id: string, userId: string): Promise<FeatureRequest> {
    return this.request<FeatureRequest>({
      method: 'POST',
      path: `/v1/widget/features/${id}/vote`,
      body: { userId },
    });
  }
}
