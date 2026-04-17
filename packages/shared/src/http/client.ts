import type { ApiResponse } from '../types/api';

/**
 * Thrown when the API returns an envelope with `ok: false`. Carries the
 * machine-readable `code` and raw `status` so callers can branch on
 * auth failures, validation errors, etc. without string-matching
 * `message`.
 */
export class KoeApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'KoeApiError';
  }
}

export interface KoeHttpRequestInit {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  /** Query params, appended as URL search. Undefined values are dropped. */
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Extra headers merged with the transport's default headers. */
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * Shared HTTP transport for Koe. Owns the envelope (`ok`/`error`)
 * unwrap, query-string encoding, and error mapping. Callers (widget
 * client, admin client) subclass it to layer in auth headers and typed
 * endpoint methods.
 */
export abstract class KoeHttpClient {
  protected readonly baseUrl: string;

  constructor(baseUrl: string) {
    // Strip a trailing slash so `${baseUrl}${path}` composes cleanly
    // regardless of how the caller passes it in.
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /**
   * Default headers applied to every request. Subclasses override to
   * add auth/project headers. Return a plain object — the request
   * dispatcher merges per-call `headers` on top.
   */
  protected abstract defaultHeaders(): Record<string, string>;

  /**
   * Whether to include browser credentials (cookies) on requests.
   * Widget: `'omit'` — host cookies must not leak to Koe.
   * Admin:  `'omit'` — admin uses bearer tokens, not cookies (yet).
   * Override to return `'include'` if/when we move to cookie sessions.
   */
  protected credentials(): RequestCredentials {
    return 'omit';
  }

  protected async request<T>(init: KoeHttpRequestInit): Promise<T> {
    const url = this.buildUrl(init.path, init.query);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...this.defaultHeaders(),
      ...(init.headers ?? {}),
    };
    if (init.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(url, {
      method: init.method ?? 'GET',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      credentials: this.credentials(),
      signal: init.signal,
    });

    return this.unwrap<T>(res);
  }

  private buildUrl(path: string, query?: KoeHttpRequestInit['query']): string {
    const full = this.baseUrl + path;
    if (!query) return full;
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      qs.set(k, String(v));
    }
    const s = qs.toString();
    return s ? `${full}?${s}` : full;
  }

  private async unwrap<T>(res: Response): Promise<T> {
    let payload: ApiResponse<T>;
    try {
      payload = (await res.json()) as ApiResponse<T>;
    } catch {
      throw new KoeApiError(
        'internal_error',
        `Koe API returned non-JSON response (status ${res.status})`,
        res.status,
      );
    }
    if (!payload.ok) {
      throw new KoeApiError(
        payload.error.code,
        payload.error.message,
        res.status,
        payload.error.details,
      );
    }
    return payload.data;
  }
}
