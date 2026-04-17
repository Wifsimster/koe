import { createHmac, timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { eq } from 'drizzle-orm';
import { db, dbAvailable, schema } from '../db';
import {
  createInMemoryNonceCache,
  verifyIdentityToken,
  type IdentitySecret,
  type NonceCache,
} from '../lib/identityToken';
import { getSecretStoreFromEnv } from '../lib/secretStore';
import type { ProjectContext } from './project';

/**
 * Computes the legacy identity hash. Kept exported so host apps that
 * already integrated against v1 do not need to change anything.
 *
 * v1 algorithm: `hex(HMAC-SHA256(identitySecret, reporterId))` transported
 * via header `X-Koe-User-Hash`.
 *
 * @deprecated New integrations should sign an identity token instead —
 * see `packages/api/src/lib/identityToken.ts`. v1 tokens have no TTL,
 * no nonce, and no rotation story, so a leaked hash is valid forever.
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
 * Verifies an identity header against the project's secrets.
 *
 * Behaviour:
 * - If `X-Koe-Identity-Token` is present, use the v2 scheme: the token's
 *   bound claims (`projectId`, `reporterId`, `iat`, `nonce`, `kid`) are
 *   checked against the project's active/retiring secrets. No silent
 *   downgrade to v1 — a malformed v2 token fails the request.
 * - Else if `X-Koe-User-Hash` is present, use the legacy v1 scheme for
 *   backward compatibility with existing integrations.
 * - Else, `project.requireIdentityVerification` decides: true → 401,
 *   false → `{verified: false}`.
 */
export type VerifyReporterFn = (
  reporterId: string,
) => Promise<{ ok: true; verified: boolean } | { ok: false; reason: string }>;

/**
 * Process-wide nonce cache. One cache covers all projects because nonces
 * are keyed by `kid:nonce` inside the verifier and kids are per-project
 * by design — collisions across projects are statistically impossible in
 * practice. Swap for a shared Redis cache when we run more than one API
 * replica (tracked for the infra MR).
 */
const nonceCache: NonceCache = createInMemoryNonceCache();

/** Max age accepted for a v2 token. Matches the 10-minute window the
 * meeting settled on — short enough to constrain replay, long enough to
 * tolerate clock drift and the time between page-load and submit. */
const V2_MAX_AGE_SECONDS = 600;

async function loadActiveSecrets(projectId: string): Promise<Map<string, IdentitySecret>> {
  if (!dbAvailable) return new Map();
  const rows = await db
    .select()
    .from(schema.projectIdentitySecrets)
    .where(eq(schema.projectIdentitySecrets.projectId, projectId));

  const secretStore = getSecretStoreFromEnv();
  const map = new Map<string, IdentitySecret>();
  for (const r of rows) {
    // Decrypt at the boundary. Rows written before KOE_SECRET_KEYS was
    // configured come back as legacy plaintext — `decrypt` detects the
    // absence of the envelope prefix and passes them through.
    map.set(r.kid, {
      kid: r.kid,
      secret: secretStore.decrypt(r.secret),
      status: r.status,
    });
  }
  return map;
}

export const attachVerifier: MiddlewareHandler<{
  Variables: ProjectContext & { verifyReporter: VerifyReporterFn };
}> = async (c, next) => {
  const project = c.get('project');
  const suppliedToken = c.req.header('X-Koe-Identity-Token') ?? null;
  const suppliedHash = c.req.header('X-Koe-User-Hash') ?? null;

  // Memoise the secret lookup so a single request does at most one DB
  // hit, even if the route calls `verifyReporter` several times.
  let secretsPromise: Promise<Map<string, IdentitySecret>> | null = null;
  const getSecrets = () => {
    if (!secretsPromise) secretsPromise = loadActiveSecrets(project.id);
    return secretsPromise;
  };

  const verify: VerifyReporterFn = async (reporterId) => {
    if (suppliedToken !== null) {
      const secrets = await getSecrets();
      const result = verifyIdentityToken(suppliedToken, secrets, {
        maxAgeSeconds: V2_MAX_AGE_SECONDS,
        expectedProjectId: project.id,
        expectedReporterId: reporterId,
        nonces: nonceCache,
      });
      if (!result.ok) {
        return { ok: false, reason: `Identity token rejected: ${result.reason}` };
      }
      return { ok: true, verified: true };
    }

    if (suppliedHash !== null) {
      const expected = computeUserHash(reporterId, project.identitySecret);
      if (!constantTimeEquals(expected, suppliedHash)) {
        return { ok: false, reason: 'Identity hash mismatch' };
      }
      return { ok: true, verified: true };
    }

    if (project.requireIdentityVerification) {
      return {
        ok: false,
        reason: 'Missing X-Koe-Identity-Token or X-Koe-User-Hash header',
      };
    }
    return { ok: true, verified: false };
  };

  c.set('verifyReporter', verify);
  await next();
};
