import type { Context } from 'hono';
import type { z } from 'zod';
import { fail } from './response';

/**
 * Parse an untrusted JSON body against a Zod schema, or respond with
 * the canonical `validation_failed` envelope. Collapses the
 * `if (!parsed.success) return fail(...)` block repeated across every
 * route handler.
 *
 * Returns a discriminated union the caller can destructure:
 *
 *   const result = await parseJsonBody(c, schema, 'Invalid payload');
 *   if (!result.ok) return result.response;
 *   const input = result.data;
 */
export async function parseJsonBody<S extends z.ZodTypeAny>(
  c: Context,
  schema: S,
  message: string,
): Promise<{ ok: true; data: z.output<S> } | { ok: false; response: Response }> {
  const body = await c.req.json().catch(() => null);
  return validateOrFail(c, schema, body, message);
}

/** Same flow as `parseJsonBody` but for already-gathered inputs (query strings, etc.). */
export function validateOrFail<S extends z.ZodTypeAny>(
  c: Context,
  schema: S,
  input: unknown,
  message: string,
): { ok: true; data: z.output<S> } | { ok: false; response: Response } {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      response: fail(c, 'validation_failed', message, 422, {
        issues: parsed.error.issues,
      }),
    };
  }
  return { ok: true, data: parsed.data };
}
