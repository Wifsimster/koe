import { createHmac, timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import type { ProjectContext } from './project';

/**
 * Computes the canonical identity hash for a `(reporterId, projectSecret)`
 * pair. Exported so host apps can mirror the same algorithm on their
 * backend and hand the widget an opaque token at page-load time.
 *
 * Algorithm: `hex(HMAC-SHA256(identitySecret, reporterId))`.
 */
export function computeUserHash(reporterId: string, identitySecret: string): string {
  return createHmac('sha256', identitySecret).update(reporterId).digest('hex');
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Verifies the `X-Koe-User-Hash` header against the project's HMAC
 * secret for the supplied reporter id.
 *
 * Behaviour:
 * - If `project.requireIdentityVerification` is true, a valid hash is
 *   mandatory. Missing or mismatched → 401.
 * - If false, the hash is verified when present (so verified reporters
 *   get `reporterVerified: true`) but is not required — letting dev
 *   projects work without a server-side signer.
 *
 * The reporter id is read from the request body after verification so
 * this middleware does not have to consume and re-emit the stream.
 * Instead we expose a `verifyReporter` helper the route calls once it
 * has the parsed body.
 */
export type VerifyReporterFn = (
  reporterId: string,
) => { ok: true; verified: boolean } | { ok: false; reason: string };

export const attachVerifier: MiddlewareHandler<{
  Variables: ProjectContext & { verifyReporter: VerifyReporterFn };
}> = async (c, next) => {
  const project = c.get('project');
  const suppliedHash = c.req.header('X-Koe-User-Hash') ?? null;

  const verify: VerifyReporterFn = (reporterId) => {
    if (!suppliedHash) {
      if (project.requireIdentityVerification) {
        return { ok: false, reason: 'Missing X-Koe-User-Hash header' };
      }
      return { ok: true, verified: false };
    }
    const expected = computeUserHash(reporterId, project.identitySecret);
    if (!constantTimeEquals(expected, suppliedHash)) {
      return { ok: false, reason: 'Identity hash mismatch' };
    }
    return { ok: true, verified: true };
  };

  c.set('verifyReporter', verify);
  await next();
};
