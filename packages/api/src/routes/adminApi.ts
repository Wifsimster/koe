import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { and, count, desc, eq, gte, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, firstOrThrow, schema } from '../db';
import { ok, fail } from '../lib/response';
import {
  requireAdminSession,
  requireProjectMember,
  type AdminContext,
} from '../middleware/adminAuth';

/**
 * JSON admin API, mounted at `/v1/admin/*`. Kept distinct from the SPA
 * serving at `/admin/*` — different concerns, different middleware
 * chain, different CORS posture.
 *
 * CORS: static allowlist from `ADMIN_DASHBOARD_ORIGIN` (single origin).
 * Widget CORS is dynamic per-project because it runs on arbitrary host
 * sites; the admin dashboard has exactly one origin.
 */
export function createAdminApiRoutes(opts: { dashboardOrigin?: string }) {
  const api = new Hono<{ Variables: AdminContext & { project: { id: string; key: string } } }>();

  // Only attach CORS when an origin is configured. In same-origin
  // deployments (dashboard served by the same Hono app at `/admin/*`),
  // the browser never fires preflights against this API.
  if (opts.dashboardOrigin) {
    api.use(
      '*',
      cors({
        origin: opts.dashboardOrigin,
        credentials: false,
        allowHeaders: ['Content-Type', 'Authorization'],
        allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      }),
    );
  }

  // All admin routes require a valid session.
  api.use('*', requireAdminSession);

  /**
   * Identity of the current session + memberships. This is the
   * "bootstrap" call the dashboard makes on load to know who the user
   * is and which projects to show in the switcher.
   */
  api.get('/me', async (c) => {
    const user = c.get('user');

    const memberships = await db
      .select({
        projectId: schema.projects.id,
        projectKey: schema.projects.key,
        projectName: schema.projects.name,
        role: schema.projectMembers.role,
      })
      .from(schema.projectMembers)
      .innerJoin(schema.projects, eq(schema.projects.id, schema.projectMembers.projectId))
      .where(eq(schema.projectMembers.userId, user.id));

    return ok(c, { user, memberships });
  });

  /**
   * Projects the current user is a member of. Returns heartbeat info
   * (last_ping_at, last_ping_origin) so the dashboard empty state can
   * show "Last ping from yoursite.com, 3 min ago" — which is how an
   * operator tells whether their <script> tag is wired at all.
   */
  api.get('/projects', async (c) => {
    const user = c.get('user');

    const rows = await db
      .select({
        id: schema.projects.id,
        key: schema.projects.key,
        name: schema.projects.name,
        accentColor: schema.projects.accentColor,
        allowedOrigins: schema.projects.allowedOrigins,
        requireIdentityVerification: schema.projects.requireIdentityVerification,
        lastPingAt: schema.projects.lastPingAt,
        lastPingOrigin: schema.projects.lastPingOrigin,
        createdAt: schema.projects.createdAt,
        role: schema.projectMembers.role,
      })
      .from(schema.projectMembers)
      .innerJoin(schema.projects, eq(schema.projects.id, schema.projectMembers.projectId))
      .where(eq(schema.projectMembers.userId, user.id))
      .orderBy(desc(schema.projects.createdAt));

    return ok(c, rows);
  });

  const ticketStatusSchema = z.enum([
    'open',
    'in_progress',
    'planned',
    'resolved',
    'closed',
    'wont_fix',
  ]);
  const ticketPrioritySchema = z.enum(['low', 'medium', 'high', 'critical']);

  const ticketQuerySchema = z.object({
    kind: z.enum(['bug', 'feature']).optional(),
    status: ticketStatusSchema.optional(),
    priority: ticketPrioritySchema.optional(),
    verified: z.enum(['true', 'false']).optional(),
    search: z.string().trim().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().max(200).optional(),
  });

  /**
   * Cursor format: `${isoCreatedAt}|${ticketId}`. Base64url-encoded so
   * clients treat it as opaque. We sort by `(created_at desc, id desc)`,
   * so the "give me rows strictly older than the cursor" predicate is
   * `(created_at, id) < (cursorCreatedAt, cursorId)` — which in SQL
   * expands to either a strictly older timestamp, or the same timestamp
   * with a strictly smaller id.
   */
  function encodeCursor(createdAt: Date, id: string): string {
    return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf-8').toString('base64url');
  }
  function decodeCursor(raw: string): { createdAt: Date; id: string } | null {
    try {
      const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
      const [iso, id] = decoded.split('|');
      if (!iso || !id) return null;
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return null;
      return { createdAt: d, id };
    } catch {
      return null;
    }
  }

  /**
   * Tickets for a project the admin is a member of. `requireProjectMember`
   * returns 404 for non-members (not 403) so this endpoint does not
   * confirm project existence to unauthorized callers.
   */
  api.get('/projects/:key/tickets', requireProjectMember, async (c) => {
    const project = c.get('project');
    const queryResult = ticketQuerySchema.safeParse({
      kind: c.req.query('kind'),
      status: c.req.query('status'),
      priority: c.req.query('priority'),
      verified: c.req.query('verified'),
      search: c.req.query('search'),
      limit: c.req.query('limit'),
      cursor: c.req.query('cursor'),
    });
    if (!queryResult.success) {
      return fail(c, 'validation_failed', 'Invalid query parameters', 422, {
        issues: queryResult.error.issues,
      });
    }
    const { kind, status, priority, verified, search, limit, cursor } = queryResult.data;

    const conditions = [eq(schema.tickets.projectId, project.id)];
    if (kind) conditions.push(eq(schema.tickets.kind, kind));
    if (status) conditions.push(eq(schema.tickets.status, status));
    if (priority) conditions.push(eq(schema.tickets.priority, priority));
    if (verified) conditions.push(eq(schema.tickets.reporterVerified, verified === 'true'));
    if (search) {
      const needle = `%${search.replace(/[%_]/g, (ch) => `\\${ch}`)}%`;
      conditions.push(
        or(
          sql`${schema.tickets.title} ilike ${needle}`,
          sql`${schema.tickets.description} ilike ${needle}`,
        )!,
      );
    }
    if (cursor) {
      const decoded = decodeCursor(cursor);
      if (!decoded) {
        return fail(c, 'validation_failed', 'Invalid cursor', 422);
      }
      conditions.push(
        or(
          lt(schema.tickets.createdAt, decoded.createdAt),
          and(
            eq(schema.tickets.createdAt, decoded.createdAt),
            lt(schema.tickets.id, decoded.id),
          )!,
        )!,
      );
    }

    // Vote count is a left-join aggregate — same pattern as the widget
    // roadmap read; no denormalized counter to drift out of sync.
    const voteCountExpr = sql<number>`count(${schema.ticketVotes.ticketId})::int`;

    // Over-fetch by one to know if there's a next page without a
    // second count query.
    const rows = await db
      .select({
        ticket: schema.tickets,
        voteCount: voteCountExpr,
      })
      .from(schema.tickets)
      .leftJoin(schema.ticketVotes, eq(schema.ticketVotes.ticketId, schema.tickets.id))
      .where(and(...conditions))
      .groupBy(schema.tickets.id)
      .orderBy(desc(schema.tickets.createdAt), desc(schema.tickets.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor(last.ticket.createdAt, last.ticket.id) : null;

    return ok(c, {
      items: page.map((r) => ({ ...r.ticket, voteCount: r.voteCount })),
      pageInfo: { nextCursor, hasMore, limit },
    });
  });

  const patchTicketSchema = z
    .object({
      status: ticketStatusSchema.optional(),
      priority: ticketPrioritySchema.optional(),
    })
    .refine((v) => v.status !== undefined || v.priority !== undefined, {
      message: 'At least one of status or priority is required',
    });

  /**
   * Partial update of a ticket. Authorization: the caller must be a
   * member of the ticket's project. We resolve the project from the
   * ticket row itself rather than taking it from the URL — that way a
   * caller can't forge membership by pointing at a ticket in a project
   * they're in, while the ticket lives in a project they aren't.
   */
  api.patch('/tickets/:id', async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');

    const body = await c.req.json().catch(() => null);
    const parsed = patchTicketSchema.safeParse(body);
    if (!parsed.success) {
      return fail(c, 'validation_failed', 'Invalid ticket update', 422, {
        issues: parsed.error.issues,
      });
    }

    // Load the ticket joined with a membership check in a single round trip.
    const rows = await db
      .select({
        ticket: schema.tickets,
        role: schema.projectMembers.role,
      })
      .from(schema.tickets)
      .innerJoin(
        schema.projectMembers,
        and(
          eq(schema.projectMembers.projectId, schema.tickets.projectId),
          eq(schema.projectMembers.userId, user.id),
        ),
      )
      .where(eq(schema.tickets.id, id))
      .limit(1);

    const row = rows[0];
    if (!row) {
      // Either the ticket does not exist, or the caller is not a
      // member. Same response for both so we don't leak existence.
      return fail(c, 'not_found', 'Ticket not found', 404);
    }

    if (row.role === 'viewer') {
      return fail(c, 'unauthorized', 'Read-only role cannot modify tickets', 403);
    }

    const updated = firstOrThrow(
      await db
        .update(schema.tickets)
        .set({
          ...(parsed.data.status ? { status: parsed.data.status } : {}),
          ...(parsed.data.priority ? { priority: parsed.data.priority } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.tickets.id, id))
        .returning(),
    );

    return ok(c, updated);
  });

  /**
   * Overview counters for the dashboard home page. One endpoint, one
   * round trip per bucket — cheap enough that we don't bother with a
   * single `SELECT count(*) FILTER (...)` query. If these become hot,
   * rewrite as a single aggregate.
   */
  api.get('/projects/:key/overview', requireProjectMember, async (c) => {
    const project = c.get('project');

    const [
      openBugs,
      openFeatures,
      criticalOpenBugs,
      resolvedLast14d,
      openedLast14d,
      topVoted,
      recent,
    ] = await Promise.all([
      db
        .select({ c: count() })
        .from(schema.tickets)
        .where(
          and(
            eq(schema.tickets.projectId, project.id),
            eq(schema.tickets.kind, 'bug'),
            eq(schema.tickets.status, 'open'),
          ),
        ),
      db
        .select({ c: count() })
        .from(schema.tickets)
        .where(
          and(
            eq(schema.tickets.projectId, project.id),
            eq(schema.tickets.kind, 'feature'),
            eq(schema.tickets.status, 'open'),
          ),
        ),
      db
        .select({ c: count() })
        .from(schema.tickets)
        .where(
          and(
            eq(schema.tickets.projectId, project.id),
            eq(schema.tickets.kind, 'bug'),
            eq(schema.tickets.status, 'open'),
            eq(schema.tickets.priority, 'critical'),
          ),
        ),
      db
        .select({ c: count() })
        .from(schema.tickets)
        .where(
          and(
            eq(schema.tickets.projectId, project.id),
            eq(schema.tickets.status, 'resolved'),
            gte(schema.tickets.updatedAt, daysAgo(14)),
          ),
        ),
      db
        .select({ c: count() })
        .from(schema.tickets)
        .where(
          and(
            eq(schema.tickets.projectId, project.id),
            gte(schema.tickets.createdAt, daysAgo(14)),
          ),
        ),
      db
        .select({
          ticket: schema.tickets,
          voteCount: sql<number>`count(${schema.ticketVotes.ticketId})::int`,
        })
        .from(schema.tickets)
        .leftJoin(schema.ticketVotes, eq(schema.ticketVotes.ticketId, schema.tickets.id))
        .where(
          and(
            eq(schema.tickets.projectId, project.id),
            eq(schema.tickets.kind, 'feature'),
            gte(schema.tickets.createdAt, daysAgo(7)),
          ),
        )
        .groupBy(schema.tickets.id)
        .orderBy(desc(sql`count(${schema.ticketVotes.ticketId})`))
        .limit(5),
      db
        .select()
        .from(schema.tickets)
        .where(eq(schema.tickets.projectId, project.id))
        .orderBy(desc(schema.tickets.createdAt))
        .limit(10),
    ]);

    return ok(c, {
      openBugs: openBugs[0]?.c ?? 0,
      openFeatures: openFeatures[0]?.c ?? 0,
      criticalOpenBugs: criticalOpenBugs[0]?.c ?? 0,
      resolvedLast14d: resolvedLast14d[0]?.c ?? 0,
      openedLast14d: openedLast14d[0]?.c ?? 0,
      topVotedThisWeek: topVoted.map((r) => ({ ...r.ticket, voteCount: r.voteCount })),
      recent,
    });
  });

  return api;
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}
