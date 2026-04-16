import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { and, eq, gt } from 'drizzle-orm';
import { db, dbAvailable, schema } from '../db';
import { fail } from '../lib/response';

/**
 * Admin authentication.
 *
 * Kept in its own middleware, deliberately NOT reusing `identity.ts`.
 * Widget identity proves "the host backend signed this reporter id".
 * Admin identity proves "this human logged into the Koe dashboard".
 * Two different trust domains. Collapsing them into one middleware is
 * how a widget bug escalates into an admin-side compromise — see the
 * meeting analysis for why we kept them siblings.
 *
 * Today this is a bearer-token session scheme:
 *   - Session tokens are 32 random bytes, encoded base64url.
 *   - Only the SHA-256 hash is persisted (`admin_sessions.token_hash`),
 *     so a DB dump does not leak any usable credential.
 *   - Raw token travels only in `Authorization: Bearer <token>`, over
 *     HTTPS, to the admin API.
 *
 * OIDC integration arrives in a later MR — the contract here (a
 * session-validator that returns a user) is the seam the provider
 * callback will plug into.
 */

export interface AdminUser {
  id: string;
  email: string;
  displayName: string | null;
}

export interface AdminContext {
  user: AdminUser;
  sessionId: string;
}

/** 32 bytes → 256 bits of entropy, base64url for URL/header safety. */
export function createRawSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * One-way hash of a raw token. We store the hash, client keeps the
 * raw token. Deterministic (no salt) because we need to look up by it;
 * length and entropy make rainbow tables useless.
 */
export function hashSessionToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Constant-time equality for hex-encoded digests. */
export function digestEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1]!.trim() : null;
}

/**
 * Validates a Bearer session token and attaches `user` + `sessionId`
 * to the Hono context. Returns 401 on any failure, deliberately
 * indistinguishable across "missing", "malformed", "unknown", and
 * "expired" — an attacker probing the endpoint should learn nothing.
 */
export const requireAdminSession: MiddlewareHandler<{ Variables: AdminContext }> = async (
  c,
  next,
) => {
  if (!dbAvailable) {
    return fail(c, 'internal_error', 'Database is not configured', 500);
  }

  const raw = extractBearer(c.req.header('Authorization'));
  if (!raw) {
    return fail(c, 'unauthorized', 'Admin session required', 401);
  }

  const tokenHash = hashSessionToken(raw);

  const rows = await db
    .select({
      sessionId: schema.adminSessions.id,
      userId: schema.adminSessions.userId,
      expiresAt: schema.adminSessions.expiresAt,
      email: schema.adminUsers.email,
      displayName: schema.adminUsers.displayName,
    })
    .from(schema.adminSessions)
    .innerJoin(schema.adminUsers, eq(schema.adminUsers.id, schema.adminSessions.userId))
    .where(
      and(
        eq(schema.adminSessions.tokenHash, tokenHash),
        gt(schema.adminSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) {
    return fail(c, 'unauthorized', 'Admin session required', 401);
  }

  c.set('user', {
    id: row.userId,
    email: row.email,
    displayName: row.displayName,
  });
  c.set('sessionId', row.sessionId);
  await next();
};

/**
 * Authorization: asserts the authenticated admin user is a member of
 * the project resolved by `c.req.param('key')`. Runs after
 * `requireAdminSession` so `user` is set. Returns 404 (not 403) on
 * non-membership — we don't confirm whether the project exists to
 * users who can't see it.
 */
export const requireProjectMember: MiddlewareHandler<{
  Variables: AdminContext & { project: { id: string; key: string } };
}> = async (c, next) => {
  const key = c.req.param('key');
  if (!key) {
    return fail(c, 'not_found', 'Project not found', 404);
  }
  const user = c.get('user');

  const rows = await db
    .select({
      projectId: schema.projects.id,
      projectKey: schema.projects.key,
    })
    .from(schema.projectMembers)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.projectMembers.projectId))
    .where(
      and(
        eq(schema.projectMembers.userId, user.id),
        eq(schema.projects.key, key),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) {
    return fail(c, 'not_found', 'Project not found', 404);
  }

  c.set('project', { id: row.projectId, key: row.projectKey });
  await next();
};
