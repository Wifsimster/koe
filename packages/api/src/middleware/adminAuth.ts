import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { and, eq, gt, lte } from 'drizzle-orm';
import { db, dbAvailable, schema } from '../db';
import { fail } from '../lib/response';

export interface AdminContext {
  admin: { email: string };
}

export const ADMIN_COOKIE_NAME = 'koe_admin';

function requireSessionSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'ADMIN_SESSION_SECRET must be set to 32+ random bytes. ' +
        'Generate with `openssl rand -hex 32`.',
    );
  }
  return secret;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

export function hashSessionToken(cookieValue: string): string {
  return createHash('sha256').update(cookieValue).digest('hex');
}

export function mintSessionCookie(expiresAtMs: number): string {
  const secret = requireSessionSecret();
  const payload = String(expiresAtMs);
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySessionCookie(raw: string | undefined): number | null {
  if (!raw) return null;
  const dot = raw.indexOf('.');
  if (dot <= 0 || dot === raw.length - 1) return null;
  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expiresAtMs = Number(payload);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) return null;
  const expected = sign(payload, requireSessionSecret());
  return safeEqualHex(sig, expected) ? expiresAtMs : null;
}

export async function recordAdminSession(cookieValue: string, expiresAtMs: number): Promise<void> {
  if (!dbAvailable) return;
  const tokenHash = hashSessionToken(cookieValue);
  await db
    .insert(schema.adminSessions)
    .values({ tokenHash, expiresAt: new Date(expiresAtMs) })
    .onConflictDoNothing();
}

export async function revokeAdminSession(cookieValue: string): Promise<number> {
  if (!dbAvailable) return 0;
  const tokenHash = hashSessionToken(cookieValue);
  const result = await db
    .delete(schema.adminSessions)
    .where(eq(schema.adminSessions.tokenHash, tokenHash))
    .returning({ tokenHash: schema.adminSessions.tokenHash });
  return result.length;
}

let lastGcAt = 0;
const GC_INTERVAL_MS = 60_000;
async function gcExpiredSessions(): Promise<void> {
  if (!dbAvailable) return;
  const now = Date.now();
  if (now - lastGcAt < GC_INTERVAL_MS) return;
  lastGcAt = now;
  try {
    await db.delete(schema.adminSessions).where(lte(schema.adminSessions.expiresAt, new Date()));
  } catch (err) {
    console.warn('[koe/api] admin_sessions GC failed', err);
  }
}

export const requireAdmin: MiddlewareHandler<{ Variables: AdminContext }> = async (c, next) => {
  const email = process.env.ADMIN_EMAIL;
  if (!email) {
    return fail(c, 'service_unavailable', 'Admin auth is not configured', 503);
  }
  const raw = getCookie(c, ADMIN_COOKIE_NAME);
  const expiresAtMs = verifySessionCookie(raw);
  if (!expiresAtMs || !raw) {
    return fail(c, 'unauthorized', 'Admin session required', 401);
  }

  if (dbAvailable) {
    const tokenHash = hashSessionToken(raw);
    const [row] = await db
      .select({ tokenHash: schema.adminSessions.tokenHash })
      .from(schema.adminSessions)
      .where(
        and(
          eq(schema.adminSessions.tokenHash, tokenHash),
          gt(schema.adminSessions.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!row) {
      return fail(c, 'unauthorized', 'Admin session required', 401);
    }
    void gcExpiredSessions();
  }

  c.set('admin', { email });
  await next();
};

export const requireSameOrigin: MiddlewareHandler = async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }

  const fetchSite = c.req.header('Sec-Fetch-Site');
  if (fetchSite) {
    if (fetchSite === 'same-origin' || fetchSite === 'same-site' || fetchSite === 'none') {
      return next();
    }
    return fail(c, 'forbidden', 'Cross-site request denied', 403);
  }

  const origin = c.req.header('Origin');
  const host = c.req.header('Host');
  if (!origin || !host) {
    return fail(c, 'forbidden', 'Missing Origin on mutating request', 403);
  }
  try {
    if (new URL(origin).host !== host) {
      return fail(c, 'forbidden', 'Cross-origin request denied', 403);
    }
  } catch {
    return fail(c, 'forbidden', 'Malformed Origin header', 403);
  }
  return next();
};
