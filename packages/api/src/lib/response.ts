import type { Context } from 'hono';
import type { ApiError, ApiErrorCode, ApiResponse } from '@koe/shared';

/** Wrap a success value in the canonical API envelope. */
export function ok<T>(c: Context, data: T, status = 200) {
  const body: ApiResponse<T> = { ok: true, data };
  return c.json(body, status as 200);
}

/** Wrap an error in the canonical API envelope. */
export function fail(
  c: Context,
  code: ApiErrorCode,
  message: string,
  status = 400,
  details?: Record<string, unknown>,
) {
  const error: ApiError = { code, message, details };
  const body: ApiResponse<never> = { ok: false, error };
  return c.json(body, status as 400);
}
