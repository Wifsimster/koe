import { createHmac, timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { eq } from 'drizzle-orm';
import { db, dbAvailable, schema } from '../db';
import {
  createNonceCacheFromEnv,
  verifyIdentityToken,
  type IdentitySecret,
  type NonceCache,
  type RedisSetNxClient,
} from '../lib/identityToken';
import { getRedisFromEnv } from '../lib/redis';
import { getSecretStoreFromEnv } from '../lib/secretStore';
import type { ProjectContext } from './project';

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

export type VerifyReporterFn = (
  reporterId: string,
) => Promise<{ ok: true; verified: boolean } | { ok: false; reason: string }>;

const nonceCache: NonceCache = createNonceCacheFromEnv(
  getRedisFromEnv() as unknown as RedisSetNxClient | null,
);

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

  let secretsPromise: Promise<Map<string, IdentitySecret>> | null = null;
  const getSecrets = () => {
    if (!secretsPromise) secretsPromise = loadActiveSecrets(project.id);
    return secretsPromise;
  };

  const verify: VerifyReporterFn = async (reporterId) => {
    if (suppliedToken !== null) {
      const secrets = await getSecrets();
      const result = await verifyIdentityToken(suppliedToken, secrets, {
        maxAgeSeconds: V2_MAX_AGE_SECONDS,
        expectedProjectId: project.id,
        expectedReporterId: reporterId,
        nonces: nonceCache,
      });
      if (!result.ok) {
        console.warn(
          '[koe/api] identity token rejected',
          JSON.stringify({
            projectId: project.id,
            reporterId,
            reason: result.reason,
            internalReason: result.internalReason,
          }),
        );
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
