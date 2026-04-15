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
}

/**
 * Thin wrapper around fetch for the widget → Koe API. Keeps transport
 * concerns (auth header, base URL, envelope unwrapping) out of components.
 */
export class KoeApiClient {
  private readonly apiUrl: string;
  private readonly projectKey: string;

  constructor(opts: KoeApiClientOptions) {
    this.apiUrl = opts.apiUrl.replace(/\/$/, '');
    this.projectKey = opts.projectKey;
  }

  async submitBugReport(input: CreateBugReportInput): Promise<BugReport> {
    return this.post<BugReport>('/v1/widget/bugs', input);
  }

  async submitFeatureRequest(
    input: CreateFeatureRequestInput,
  ): Promise<FeatureRequest> {
    return this.post<FeatureRequest>('/v1/widget/features', input);
  }

  async listFeatureRequests(): Promise<FeatureRequest[]> {
    return this.get<FeatureRequest[]>('/v1/widget/features');
  }

  async voteFeature(id: string, userId: string): Promise<FeatureRequest> {
    return this.post<FeatureRequest>(`/v1/widget/features/${id}/vote`, { userId });
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(this.apiUrl + path, {
      method: 'GET',
      headers: this.headers(),
    });
    return this.unwrap<T>(res);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(this.apiUrl + path, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    return this.unwrap<T>(res);
  }

  private headers(): HeadersInit {
    return {
      'Content-Type': 'application/json',
      'X-Koe-Project-Key': this.projectKey,
    };
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
