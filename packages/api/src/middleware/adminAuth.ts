import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { and, eq, gt } from 'drizzle-orm';
import { db, dbAvailable, schema } from '../db';
import { fail } from '../lib/response';

/**
 * Name of the session cookie set by the OIDC callback. Read here so
 * the middleware can accept cookie-based browser sessions alongside
 * the bearer-token CLI flow. Kept as a module-level constant rather
 * than injected — both values are process-wide and the middleware
 * must stay a plain `MiddlewareHandler` so existing call sites don't
 * change.
 */
const SESSION_COOKIE_NAME = process.env.ADMIN_SESSION_COOKIE ?? 'koe_admin';

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
 * Session transport: either `Authorization: Bearer <token>` (the dev
 * CLI path) or a plain session cookie set by the OIDC callback. The
 * value is the same 32-byte base64url token in both cases — the
 * server hashes with SHA-256 and looks up. Only the hash persists in
 * the DB, so a dump leaks no usable credential.
 *
 * The session cookie is not signed. It doesn't need to be: the value
 * is already cryptographically unguessable, and the middleware
 * verifies it against the stored hash. Signing would add overhead
 * without adding protection against any realistic attacker model.
 * (The transient OIDC state cookie during the login dance IS signed
 * — see `routes/oidcAuth.ts`. There the cookie carries unpredictable
 * secrets the attacker must not forge.)
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

  // Bearer header wins when both are present — it's the explicit
  // intent, used by the CLI and by service-to-admin callers.
  const raw =
    extractBearer(c.req.header('Authorization')) ?? getCookie(c, SESSION_COOKIE_NAME) ?? null;
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

export type ProjectRole = 'owner' | 'member' | 'viewer';

export interface ProjectMembership {
  id: string;
  key: string;
  role: ProjectRole;
}

/**
 * Authorization: asserts the authenticated admin user is a member of
 * the project resolved by `c.req.param('key')`. Runs after
 * `requireAdminSession` so `user` is set. Returns 404 (not 403) on
 * non-membership — we don't confirm whether the project exists to
 * users who can't see it.
 *
 * Attaches `project` (id + key + role) to the context. Downstream
 * handlers that need to gate writes check `project.role` — see
 * `requireProjectWriter` below.
 */
export const requireProjectMember: MiddlewareHandler<{
  Variables: AdminContext & { project: ProjectMembership };
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
      role: schema.projectMembers.role,
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

  c.set('project', {
    id: row.projectId,
    key: row.projectKey,
    role: row.role,
  });
  await next();
};

/**
 * Write-gate: requires the member's role to be `owner` or `member`.
 * `viewer` callers get the same 404 as a non-member — same reason,
 * we don't signal "you're here but can't act" when "you're not here"
 * is the safe response.
 *
 * Mount after `requireProjectMember` in the middleware chain. Kept as
 * a sibling (not a replacement) so read-only routes don't pay for
 * the extra branch.
 */
export const requireProjectWriter: MiddlewareHandler<{
  Variables: AdminContext & { project: ProjectMembership };
}> = async (c, next) => {
  const project = c.get('project');
  if (project.role === 'viewer') {
    return fail(c, 'not_found', 'Project not found', 404);
  }
  await next();
};
