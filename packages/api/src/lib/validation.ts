import type { Context } from 'hono';
import type { z } from 'zod';
import { fail } from './response';

export async function parseJsonBody<S extends z.ZodTypeAny>(
  c: Context,
  schema: S,
  message: string,
): Promise<{ ok: true; data: z.output<S> } | { ok: false; response: Response }> {
  const body = await c.req.json().catch(() => null);
  return validateOrFail(c, schema, body, message);
}

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
