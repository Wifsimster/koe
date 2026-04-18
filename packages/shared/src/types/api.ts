/**
 * Canonical shape for all API responses.
 * Using a discriminated union lets clients exhaustively handle both paths.
 */
export type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export type ApiErrorCode =
  | 'invalid_project_key'
  | 'origin_not_allowed'
  | 'validation_failed'
  | 'not_found'
  | 'unauthorized'
  | 'forbidden'
  | 'conflict'
  | 'rate_limited'
  | 'service_unavailable'
  | 'internal_error';
