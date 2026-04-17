import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { and, count, desc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { TicketPriority, TicketStatus } from '@koe/shared';
import { z } from 'zod';
import { db, firstOrThrow, schema } from '../db';
import { ok, fail } from '../lib/response';
import {
  requireAdminSession,
  requireProjectMember,
  requireProjectWriter,
  type AdminContext,
  type ProjectMembership,
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
  const api = new Hono<{ Variables: AdminContext & { project: ProjectMembership } }>();

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
    /**
     * Assignee filter. `me` resolves to the calling user's id,
     * `unassigned` matches tickets with no assignee, and a bare uuid
     * matches a specific project member. Kept as a string union rather
     * than a uuid-only field so the `me` / `unassigned` shortcuts stay
     * shareable in URLs.
     */
    assignee: z
      .union([z.literal('me'), z.literal('unassigned'), z.string().uuid()])
      .optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().max(200).optional(),
  });

  /**
   * Cursor format: `${isoCreatedAt}|${ticketId}`, base64url-encoded so
   * clients treat it as opaque. We sort by `(created_at desc, id desc)`,
   * so the "give me rows strictly older than the cursor" predicate is
   * `(created_at, id) < (cursorCreatedAt, cursorId)` — which expands to
   * either a strictly older timestamp, or the same timestamp with a
   * strictly smaller id. This avoids the offset-based pagination trap
   * where late inserts shift page boundaries.
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
   *
   * Filters are composable: `kind`, `status`, `priority`, `verified`,
   * plus a free-text `search` over title and description. Pagination
   * is cursor-based — the response carries `pageInfo.nextCursor` when
   * more rows exist.
   */
  api.get('/projects/:key/tickets', requireProjectMember, async (c) => {
    const project = c.get('project');
    const user = c.get('user');
    const queryResult = ticketQuerySchema.safeParse({
      kind: c.req.query('kind'),
      status: c.req.query('status'),
      priority: c.req.query('priority'),
      verified: c.req.query('verified'),
      search: c.req.query('search'),
      assignee: c.req.query('assignee'),
      limit: c.req.query('limit'),
      cursor: c.req.query('cursor'),
    });
    if (!queryResult.success) {
      return fail(c, 'validation_failed', 'Invalid query parameters', 422, {
        issues: queryResult.error.issues,
      });
    }
    const { kind, status, priority, verified, search, assignee, limit, cursor } =
      queryResult.data;

    const conditions = [eq(schema.tickets.projectId, project.id)];
    if (kind) conditions.push(eq(schema.tickets.kind, kind));
    if (status) conditions.push(eq(schema.tickets.status, status));
    if (priority) conditions.push(eq(schema.tickets.priority, priority));
    if (verified) conditions.push(eq(schema.tickets.reporterVerified, verified === 'true'));
    if (assignee === 'unassigned') {
      conditions.push(isNull(schema.tickets.assignedToUserId));
    } else if (assignee === 'me') {
      conditions.push(eq(schema.tickets.assignedToUserId, user.id));
    } else if (assignee) {
      // Bare uuid — specific user. No project-membership check here:
      // the filter is a read hint, and the result set is already
      // scoped to this project via `projectId`. An outsider's uuid
      // just returns zero rows.
      conditions.push(eq(schema.tickets.assignedToUserId, assignee));
    }
    if (search) {
      // Escape the ILIKE wildcards so a search for `50%` matches
      // literally. We pick `\\` as the escape char because Postgres
      // accepts the default backslash without an explicit ESCAPE clause.
      const needle = `%${search.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`;
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

    // Over-fetch by one so we can tell there's a next page without a
    // second count query. Left-join `admin_users` via the nullable
    // `assigned_to_user_id` so the inbox card can render the
    // assignee's email without a second round-trip per ticket.
    const rows = await db
      .select({
        ticket: schema.tickets,
        voteCount: voteCountExpr,
        assignedToEmail: schema.adminUsers.email,
        assignedToDisplayName: schema.adminUsers.displayName,
      })
      .from(schema.tickets)
      .leftJoin(schema.ticketVotes, eq(schema.ticketVotes.ticketId, schema.tickets.id))
      .leftJoin(
        schema.adminUsers,
        eq(schema.adminUsers.id, schema.tickets.assignedToUserId),
      )
      .where(and(...conditions))
      .groupBy(schema.tickets.id, schema.adminUsers.id)
      .orderBy(desc(schema.tickets.createdAt), desc(schema.tickets.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor(last.ticket.createdAt, last.ticket.id) : null;

    return ok(c, {
      items: page.map((r) => ({
        ...r.ticket,
        voteCount: r.voteCount,
        assignedToEmail: r.assignedToEmail,
        assignedToDisplayName: r.assignedToDisplayName,
      })),
      pageInfo: { nextCursor, hasMore, limit },
    });
  });

  /**
   * Project-level overview counters the dashboard landing page needs.
   * One endpoint, several aggregate queries fanned out in parallel —
   * cheap enough at operator scale that we don't bother with a single
   * `count() FILTER (...)` query. If this becomes hot, rewrite as one
   * aggregate.
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

  /**
   * Triage mutation. Owners and members can change status/priority;
   * viewers get the same 404 as a non-member.
   *
   * Partial update: both fields optional, at least one required. We
   * don't expose other columns on purpose — things like
   * `reporter_email` and `metadata` come from the submitter and must
   * not be rewritable here. Notes / comments are a separate surface.
   */
  const patchTicketSchema = z
    .object({
      status: z
        .enum(['open', 'in_progress', 'planned', 'resolved', 'closed', 'wont_fix'])
        .optional(),
      priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
      // `null` explicitly unassigns; a uuid sets. `undefined` (absent
      // key) means "no change" — different from null, which is the
      // canonical clear-the-field shape.
      assignedToUserId: z.string().uuid().nullable().optional(),
    })
    .refine(
      (v) =>
        v.status !== undefined ||
        v.priority !== undefined ||
        v.assignedToUserId !== undefined,
      {
        message:
          'At least one of status, priority, or assignedToUserId is required',
      },
    );

  api.patch(
    '/projects/:key/tickets/:id',
    requireProjectMember,
    requireProjectWriter,
    async (c) => {
      const project = c.get('project');
      const user = c.get('user');
      const id = c.req.param('id');

      const body = await c.req.json().catch(() => null);
      const parsed = patchTicketSchema.safeParse(body);
      if (!parsed.success) {
        return fail(c, 'validation_failed', 'Invalid patch payload', 422, {
          issues: parsed.error.issues,
        });
      }

      // UPDATE + audit events in one transaction: if either step
      // fails, neither half lands. The SELECT-for-before is inside
      // the same tx so a concurrent mutation can't shift the ground
      // between our read and our write.
      const result = await db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(schema.tickets)
          .where(
            and(
              eq(schema.tickets.id, id),
              eq(schema.tickets.projectId, project.id),
            ),
          )
          .limit(1);
        if (!before) return { notFound: true } as const;

        // Assignee must be a member of *this* project. An admin user
        // unknown to the project can't own its tickets — both because
        // they couldn't act on it and because leaking membership via
        // assignment would be an info-disclosure bug. `null` bypasses
        // the check because unassigning is always allowed.
        if (
          parsed.data.assignedToUserId !== undefined &&
          parsed.data.assignedToUserId !== null
        ) {
          const [assignee] = await tx
            .select({ userId: schema.projectMembers.userId })
            .from(schema.projectMembers)
            .where(
              and(
                eq(schema.projectMembers.projectId, project.id),
                eq(schema.projectMembers.userId, parsed.data.assignedToUserId),
              ),
            )
            .limit(1);
          if (!assignee) {
            return { notFound: false, invalidAssignee: true } as const;
          }
        }

        const updated = await tx
          .update(schema.tickets)
          .set({
            ...(parsed.data.status ? { status: parsed.data.status } : {}),
            ...(parsed.data.priority ? { priority: parsed.data.priority } : {}),
            ...(parsed.data.assignedToUserId !== undefined
              ? { assignedToUserId: parsed.data.assignedToUserId }
              : {}),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.tickets.id, id),
              eq(schema.tickets.projectId, project.id),
            ),
          )
          .returning();
        const after = firstOrThrow(updated, 'ticket after update');

        // Emit one event per field that actually changed. A PATCH
        // that sets status to the same value is silent in the log —
        // we don't pollute the audit trail with no-ops.
        const events: Array<{
          ticketId: string;
          actorUserId: string;
          kind: 'status_changed' | 'priority_changed' | 'assigned';
          payload: Record<string, unknown>;
        }> = [];
        if (parsed.data.status && parsed.data.status !== before.status) {
          events.push({
            ticketId: id,
            actorUserId: user.id,
            kind: 'status_changed',
            payload: { from: before.status, to: parsed.data.status },
          });
        }
        if (parsed.data.priority && parsed.data.priority !== before.priority) {
          events.push({
            ticketId: id,
            actorUserId: user.id,
            kind: 'priority_changed',
            payload: { from: before.priority, to: parsed.data.priority },
          });
        }
        if (
          parsed.data.assignedToUserId !== undefined &&
          parsed.data.assignedToUserId !== before.assignedToUserId
        ) {
          events.push({
            ticketId: id,
            actorUserId: user.id,
            kind: 'assigned',
            payload: {
              fromUserId: before.assignedToUserId,
              toUserId: parsed.data.assignedToUserId,
            },
          });
        }
        if (events.length > 0) {
          await tx.insert(schema.adminTicketEvents).values(events);
        }

        return { notFound: false, after } as const;
      });

      if (result.notFound) {
        return fail(c, 'not_found', 'Ticket not found', 404);
      }
      if ('invalidAssignee' in result && result.invalidAssignee) {
        return fail(
          c,
          'validation_failed',
          'assignedToUserId must refer to a member of this project',
          422,
        );
      }

      // Re-read with the aggregate vote count + the assignee's
      // email so the dashboard gets the same shape it receives
      // from the list endpoint.
      const voteCountExpr = sql<number>`count(${schema.ticketVotes.ticketId})::int`;
      const [withVotes] = await db
        .select({
          ticket: schema.tickets,
          voteCount: voteCountExpr,
          assignedToEmail: schema.adminUsers.email,
          assignedToDisplayName: schema.adminUsers.displayName,
        })
        .from(schema.tickets)
        .leftJoin(schema.ticketVotes, eq(schema.ticketVotes.ticketId, schema.tickets.id))
        .leftJoin(
          schema.adminUsers,
          eq(schema.adminUsers.id, schema.tickets.assignedToUserId),
        )
        .where(eq(schema.tickets.id, id))
        .groupBy(schema.tickets.id, schema.adminUsers.id);

      const row = firstOrThrow(withVotes ? [withVotes] : []);
      return ok(c, {
        ...row.ticket,
        voteCount: row.voteCount,
        assignedToEmail: row.assignedToEmail,
        assignedToDisplayName: row.assignedToDisplayName,
      });
    },
  );

  /**
   * Audit trail for a ticket. Read-only and available to every member
   * of the project (including viewers) — the history is the first
   * thing an operator asks for when triaging "why is this open again?".
   *
   * Joined with `admin_users` so the dashboard can render the actor's
   * email without a second round trip. Deleted users come back as
   * `actorEmail: null` (the FK is `ON DELETE SET NULL`).
   */
  api.get(
    '/projects/:key/tickets/:id/events',
    requireProjectMember,
    async (c) => {
      const project = c.get('project');
      const id = c.req.param('id');

      // Confirm the ticket belongs to this project before exposing
      // its audit log — same IDOR protection as the mutation path.
      const [ticket] = await db
        .select({ id: schema.tickets.id })
        .from(schema.tickets)
        .where(
          and(
            eq(schema.tickets.id, id),
            eq(schema.tickets.projectId, project.id),
          ),
        )
        .limit(1);
      if (!ticket) {
        return fail(c, 'not_found', 'Ticket not found', 404);
      }

      const rows = await db
        .select({
          id: schema.adminTicketEvents.id,
          ticketId: schema.adminTicketEvents.ticketId,
          kind: schema.adminTicketEvents.kind,
          payload: schema.adminTicketEvents.payload,
          createdAt: schema.adminTicketEvents.createdAt,
          actorUserId: schema.adminTicketEvents.actorUserId,
          actorEmail: schema.adminUsers.email,
        })
        .from(schema.adminTicketEvents)
        .leftJoin(
          schema.adminUsers,
          eq(schema.adminUsers.id, schema.adminTicketEvents.actorUserId),
        )
        .where(eq(schema.adminTicketEvents.ticketId, id))
        .orderBy(desc(schema.adminTicketEvents.createdAt))
        .limit(200);

      return ok(c, rows);
    },
  );

  /**
   * Members of a project, for the assignment picker. Joined with
   * `admin_users` so the dashboard gets email + displayName in one
   * round-trip. Available to every member (viewer included) — knowing
   * who's on the project is a read operation, not a privileged one.
   */
  api.get(
    '/projects/:key/members',
    requireProjectMember,
    async (c) => {
      const project = c.get('project');
      const rows = await db
        .select({
          userId: schema.adminUsers.id,
          email: schema.adminUsers.email,
          displayName: schema.adminUsers.displayName,
          role: schema.projectMembers.role,
        })
        .from(schema.projectMembers)
        .innerJoin(
          schema.adminUsers,
          eq(schema.adminUsers.id, schema.projectMembers.userId),
        )
        .where(eq(schema.projectMembers.projectId, project.id))
        .orderBy(schema.adminUsers.email);

      return ok(c, rows);
    },
  );

  /**
   * Ticket comments — internal triage notes shared among admin
   * members. Separate from the widget-facing `messages` surface
   * (which is the reporter chat, not built today). Read is open to
   * every project member; write is writer-gated.
   *
   * Writing a comment also emits a `commented` event in the same
   * transaction so the Activity feed stays the single source of
   * truth for "what has happened to this ticket".
   */
  api.get(
    '/projects/:key/tickets/:id/comments',
    requireProjectMember,
    async (c) => {
      const project = c.get('project');
      const id = c.req.param('id');

      // IDOR guard — same pattern as the events endpoint.
      const [ticket] = await db
        .select({ id: schema.tickets.id })
        .from(schema.tickets)
        .where(
          and(
            eq(schema.tickets.id, id),
            eq(schema.tickets.projectId, project.id),
          ),
        )
        .limit(1);
      if (!ticket) {
        return fail(c, 'not_found', 'Ticket not found', 404);
      }

      const rows = await db
        .select({
          id: schema.adminTicketComments.id,
          ticketId: schema.adminTicketComments.ticketId,
          body: schema.adminTicketComments.body,
          createdAt: schema.adminTicketComments.createdAt,
          authorUserId: schema.adminTicketComments.authorUserId,
          authorEmail: schema.adminUsers.email,
          authorDisplayName: schema.adminUsers.displayName,
        })
        .from(schema.adminTicketComments)
        .leftJoin(
          schema.adminUsers,
          eq(schema.adminUsers.id, schema.adminTicketComments.authorUserId),
        )
        .where(eq(schema.adminTicketComments.ticketId, id))
        .orderBy(desc(schema.adminTicketComments.createdAt))
        .limit(200);

      return ok(c, rows);
    },
  );

  const createCommentSchema = z.object({
    body: z.string().trim().min(1).max(10_000),
  });

  api.post(
    '/projects/:key/tickets/:id/comments',
    requireProjectMember,
    requireProjectWriter,
    async (c) => {
      const project = c.get('project');
      const user = c.get('user');
      const id = c.req.param('id');

      const body = await c.req.json().catch(() => null);
      const parsed = createCommentSchema.safeParse(body);
      if (!parsed.success) {
        return fail(c, 'validation_failed', 'Invalid comment payload', 422, {
          issues: parsed.error.issues,
        });
      }

      // Comment + audit event in one transaction. If the event
      // insert fails the comment doesn't land either — the feed
      // can't diverge from reality.
      const created = await db.transaction(async (tx) => {
        // Confirm the ticket belongs to this project before
        // creating a comment under it.
        const [ticket] = await tx
          .select({ id: schema.tickets.id })
          .from(schema.tickets)
          .where(
            and(
              eq(schema.tickets.id, id),
              eq(schema.tickets.projectId, project.id),
            ),
          )
          .limit(1);
        if (!ticket) return { notFound: true } as const;

        const [row] = await tx
          .insert(schema.adminTicketComments)
          .values({
            ticketId: id,
            authorUserId: user.id,
            body: parsed.data.body,
          })
          .returning();
        const comment = firstOrThrow(row ? [row] : [], 'comment after insert');

        // Payload carries the comment id + a short excerpt so the
        // audit trail is readable without a second fetch. The full
        // body lives in `admin_ticket_comments` itself.
        const excerpt = comment.body.slice(0, 200);
        await tx.insert(schema.adminTicketEvents).values({
          ticketId: id,
          actorUserId: user.id,
          kind: 'commented',
          payload: { commentId: comment.id, excerpt },
        });

        return { notFound: false, comment } as const;
      });

      if (created.notFound) {
        return fail(c, 'not_found', 'Ticket not found', 404);
      }
      return ok(
        c,
        {
          ...created.comment,
          authorEmail: user.email,
          authorDisplayName: user.displayName,
        },
        201,
      );
    },
  );

  /**
   * Bulk mutation — apply the same patch to up to 100 tickets in one
   * call. Sibling of the single-ticket PATCH, not a replacement: the
   * single form keeps its audit + response shape, this one optimises
   * the "close these 20 duplicates" flow without making the UI walk a
   * for-loop of requests.
   *
   * Semantics:
   *   - Writer-gated, same as the single PATCH.
   *   - All ids are scoped to the caller's project via the same
   *     `(id, project_id)` WHERE the single form uses. Ids that
   *     don't match are reported as `failed` with `reason: 'not_found'`.
   *   - Assignee membership is validated once up front (the patch is
   *     the same for every id); if it's bad we fail the whole batch
   *     with a 422 — the caller never gets a partial write for that
   *     case.
   *   - Audit events are emitted per actually-changed field per
   *     ticket, same shape as the single PATCH. A noop-for-this-row
   *     ticket is silent.
   *   - One transaction for the whole batch. Either every row lands
   *     or none do.
   */
  const bulkPatchSchema = z
    .object({
      ids: z.array(z.string().uuid()).min(1).max(100),
      patch: z
        .object({
          status: ticketStatusSchema.optional(),
          priority: ticketPrioritySchema.optional(),
          assignedToUserId: z.string().uuid().nullable().optional(),
        })
        .refine(
          (v) =>
            v.status !== undefined ||
            v.priority !== undefined ||
            v.assignedToUserId !== undefined,
          {
            message:
              'At least one of status, priority, or assignedToUserId is required',
          },
        ),
    });

  api.post(
    '/projects/:key/tickets/bulk',
    requireProjectMember,
    requireProjectWriter,
    async (c) => {
      const project = c.get('project');
      const user = c.get('user');

      const body = await c.req.json().catch(() => null);
      const parsed = bulkPatchSchema.safeParse(body);
      if (!parsed.success) {
        return fail(c, 'validation_failed', 'Invalid bulk payload', 422, {
          issues: parsed.error.issues,
        });
      }
      const { ids, patch } = parsed.data;

      type Failure = { id: string; reason: 'not_found' };
      const result = await db.transaction(async (tx) => {
        // Validate the assignee once. The same patch applies to every
        // id, so checking per-row would be wasted round-trips.
        if (patch.assignedToUserId !== undefined && patch.assignedToUserId !== null) {
          const [assignee] = await tx
            .select({ userId: schema.projectMembers.userId })
            .from(schema.projectMembers)
            .where(
              and(
                eq(schema.projectMembers.projectId, project.id),
                eq(schema.projectMembers.userId, patch.assignedToUserId),
              ),
            )
            .limit(1);
          if (!assignee) {
            return { invalidAssignee: true } as const;
          }
        }

        // Fetch the before-state for every id that actually belongs
        // to this project. Ids that aren't in the result set = not
        // ours, and land in `failed` with a uniform reason.
        const before = await tx
          .select()
          .from(schema.tickets)
          .where(
            and(
              eq(schema.tickets.projectId, project.id),
              inArray(schema.tickets.id, ids),
            ),
          );
        const beforeById = new Map(before.map((t) => [t.id, t]));
        const failed: Failure[] = ids
          .filter((id) => !beforeById.has(id))
          .map((id) => ({ id, reason: 'not_found' }));

        if (before.length === 0) {
          return { invalidAssignee: false, updatedCount: 0, failed } as const;
        }

        // A single UPDATE with an `IN (…)` WHERE. Drizzle batches
        // values + where, Postgres executes one statement.
        const updated = await tx
          .update(schema.tickets)
          .set({
            ...(patch.status ? { status: patch.status } : {}),
            ...(patch.priority ? { priority: patch.priority } : {}),
            ...(patch.assignedToUserId !== undefined
              ? { assignedToUserId: patch.assignedToUserId }
              : {}),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.tickets.projectId, project.id),
              inArray(
                schema.tickets.id,
                before.map((t) => t.id),
              ),
            ),
          )
          .returning({ id: schema.tickets.id });

        // One audit event per actually-changed field per ticket.
        // Same shape as the single PATCH — the Activity feed can't
        // tell whether a change came from bulk or not, which is
        // intentional: the log is about what happened, not how.
        const events: Array<{
          ticketId: string;
          actorUserId: string;
          kind: 'status_changed' | 'priority_changed' | 'assigned';
          payload: Record<string, unknown>;
        }> = [];
        for (const row of before) {
          if (patch.status && patch.status !== row.status) {
            events.push({
              ticketId: row.id,
              actorUserId: user.id,
              kind: 'status_changed',
              payload: { from: row.status, to: patch.status },
            });
          }
          if (patch.priority && patch.priority !== row.priority) {
            events.push({
              ticketId: row.id,
              actorUserId: user.id,
              kind: 'priority_changed',
              payload: { from: row.priority, to: patch.priority },
            });
          }
          if (
            patch.assignedToUserId !== undefined &&
            patch.assignedToUserId !== row.assignedToUserId
          ) {
            events.push({
              ticketId: row.id,
              actorUserId: user.id,
              kind: 'assigned',
              payload: {
                fromUserId: row.assignedToUserId,
                toUserId: patch.assignedToUserId,
              },
            });
          }
        }
        if (events.length > 0) {
          await tx.insert(schema.adminTicketEvents).values(events);
        }

        return {
          invalidAssignee: false,
          updatedCount: updated.length,
          failed,
        } as const;
      });

      if ('invalidAssignee' in result && result.invalidAssignee) {
        return fail(
          c,
          'validation_failed',
          'assignedToUserId must refer to a member of this project',
          422,
        );
      }

      return ok(c, {
        updated: result.updatedCount,
        failed: result.failed,
      });
    },
  );

  /**
   * Revert a single audit event. "Take this ticket back to the
   * `from` value stored on this event, and log the delta as a new
   * event." Works for `status_changed`, `priority_changed`, and
   * `assigned`; `commented` is ignored because deleting a comment is
   * a different flow that may arrive later.
   *
   * Semantics:
   *   - The revert is always against the *current* ticket state.
   *     If the ticket moved since the event, we still rewind to the
   *     event's `from`, but the new audit entry honestly describes
   *     the delta that actually landed (from current → from).
   *   - A no-op (current already equals the target) returns 200
   *     without emitting a new event. Keeps the audit trail clean.
   *   - Same writer gate as the mutations. Viewers can see the
   *     button-less Activity entry; the button only renders client-
   *     side when the role permits.
   *   - One transaction, same pattern as PATCH.
   */
  api.post(
    '/projects/:key/tickets/:id/events/:eventId/revert',
    requireProjectMember,
    requireProjectWriter,
    async (c) => {
      const project = c.get('project');
      const user = c.get('user');
      const ticketId = c.req.param('id');
      const eventId = c.req.param('eventId');

      const outcome = await db.transaction(async (tx) => {
        // Fetch the ticket + event together, scoped to this project.
        // The join against `tickets` by `(id, project_id)` is the
        // IDOR guard — an event belonging to another project, or an
        // event whose ticket was cross-routed, won't match.
        const [row] = await tx
          .select({
            ticket: schema.tickets,
            event: schema.adminTicketEvents,
          })
          .from(schema.adminTicketEvents)
          .innerJoin(
            schema.tickets,
            eq(schema.tickets.id, schema.adminTicketEvents.ticketId),
          )
          .where(
            and(
              eq(schema.adminTicketEvents.id, eventId),
              eq(schema.adminTicketEvents.ticketId, ticketId),
              eq(schema.tickets.projectId, project.id),
            ),
          )
          .limit(1);
        if (!row) return { kind: 'not_found' } as const;

        const { ticket, event } = row;
        const payload = event.payload as Record<string, unknown>;

        // Decide what to write, per kind.
        let nextField:
          | { column: 'status'; value: TicketStatus; currentValue: TicketStatus }
          | { column: 'priority'; value: TicketPriority; currentValue: TicketPriority }
          | { column: 'assignedToUserId'; value: string | null; currentValue: string | null }
          | null = null;

        if (event.kind === 'status_changed') {
          const from = typeof payload.from === 'string' ? payload.from : null;
          if (from && isTicketStatus(from)) {
            nextField = {
              column: 'status',
              value: from,
              currentValue: ticket.status,
            };
          }
        } else if (event.kind === 'priority_changed') {
          const from = typeof payload.from === 'string' ? payload.from : null;
          if (from && isTicketPriority(from)) {
            nextField = {
              column: 'priority',
              value: from,
              currentValue: ticket.priority,
            };
          }
        } else if (event.kind === 'assigned') {
          // `fromUserId` can be null (assign-from-unassigned) or a uuid.
          const from =
            payload.fromUserId === null
              ? null
              : typeof payload.fromUserId === 'string'
                ? payload.fromUserId
                : undefined;
          if (from !== undefined) {
            nextField = {
              column: 'assignedToUserId',
              value: from,
              currentValue: ticket.assignedToUserId,
            };
          }
        }

        if (!nextField) {
          // Comment events or malformed payloads — nothing to revert.
          return { kind: 'unrevertable' } as const;
        }

        // No-op revert = honest silence. Audit stays clean.
        if (nextField.value === nextField.currentValue) {
          return { kind: 'noop', ticket } as const;
        }

        // If we're restoring an assignee, verify they're still a
        // member of this project. Someone removed since the original
        // event can't be re-assigned; surface that as a 422 rather
        // than silently unassigning.
        if (
          nextField.column === 'assignedToUserId' &&
          nextField.value !== null
        ) {
          const [stillMember] = await tx
            .select({ userId: schema.projectMembers.userId })
            .from(schema.projectMembers)
            .where(
              and(
                eq(schema.projectMembers.projectId, project.id),
                eq(schema.projectMembers.userId, nextField.value),
              ),
            )
            .limit(1);
          if (!stillMember) {
            return { kind: 'assignee_gone', userId: nextField.value } as const;
          }
        }

        await tx
          .update(schema.tickets)
          .set({
            ...(nextField.column === 'status' ? { status: nextField.value } : {}),
            ...(nextField.column === 'priority' ? { priority: nextField.value } : {}),
            ...(nextField.column === 'assignedToUserId'
              ? { assignedToUserId: nextField.value }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(schema.tickets.id, ticketId));

        // Emit a new event describing what actually happened. Same
        // kind as the original, payload is the true delta (current →
        // reverted value). A reader scanning the log sees a coherent
        // story, not an "undo" pseudo-kind.
        await tx.insert(schema.adminTicketEvents).values({
          ticketId,
          actorUserId: user.id,
          kind: event.kind,
          payload:
            nextField.column === 'assignedToUserId'
              ? {
                  fromUserId: nextField.currentValue,
                  toUserId: nextField.value,
                  revertOf: event.id,
                }
              : {
                  from: nextField.currentValue,
                  to: nextField.value,
                  revertOf: event.id,
                },
        });

        return { kind: 'reverted' } as const;
      });

      if (outcome.kind === 'not_found') {
        return fail(c, 'not_found', 'Event not found', 404);
      }
      if (outcome.kind === 'unrevertable') {
        return fail(
          c,
          'validation_failed',
          'This event kind cannot be reverted',
          422,
        );
      }
      if (outcome.kind === 'assignee_gone') {
        return fail(
          c,
          'validation_failed',
          'The original assignee is no longer a member of this project',
          422,
        );
      }

      // Re-read the full ticket with the same shape as list/PATCH.
      const voteCountExpr = sql<number>`count(${schema.ticketVotes.ticketId})::int`;
      const [withVotes] = await db
        .select({
          ticket: schema.tickets,
          voteCount: voteCountExpr,
          assignedToEmail: schema.adminUsers.email,
          assignedToDisplayName: schema.adminUsers.displayName,
        })
        .from(schema.tickets)
        .leftJoin(schema.ticketVotes, eq(schema.ticketVotes.ticketId, schema.tickets.id))
        .leftJoin(
          schema.adminUsers,
          eq(schema.adminUsers.id, schema.tickets.assignedToUserId),
        )
        .where(eq(schema.tickets.id, ticketId))
        .groupBy(schema.tickets.id, schema.adminUsers.id);

      const row = firstOrThrow(withVotes ? [withVotes] : []);
      return ok(c, {
        ...row.ticket,
        voteCount: row.voteCount,
        assignedToEmail: row.assignedToEmail,
        assignedToDisplayName: row.assignedToDisplayName,
      });
    },
  );

  return api;
}

function isTicketStatus(v: string): v is TicketStatus {
  return (
    v === 'open' ||
    v === 'in_progress' ||
    v === 'planned' ||
    v === 'resolved' ||
    v === 'closed' ||
    v === 'wont_fix'
  );
}

function isTicketPriority(v: string): v is TicketPriority {
  return v === 'low' || v === 'medium' || v === 'high' || v === 'critical';
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}
