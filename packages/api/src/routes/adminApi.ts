import { randomBytes, randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import type { TicketPriority, TicketStatus } from '@koe/shared';
import { z } from 'zod';
import { db, firstOrThrow, schema } from '../db';
import { ok, fail } from '../lib/response';
import { getSecretStoreFromEnv } from '../lib/secretStore';
import { requireAdmin, type AdminContext } from '../middleware/adminAuth';
import type { MiddlewareHandler } from 'hono';

/**
 * JSON admin API, mounted at `/v1/admin/*`. Single-admin product —
 * one founder managing multiple of their own SaaS projects. There
 * are no roles, no members, no per-project access control: if the
 * caller proved they're the admin, every project is theirs.
 */
export function createAdminApiRoutes() {
  const api = new Hono<{ Variables: AdminContext & { project: { id: string; key: string } } }>();

  // All admin routes require a valid session.
  api.use('*', requireAdmin);

  /**
   * Identity probe. Returns the configured admin email — the dashboard
   * calls this on load to confirm the cookie is still valid.
   */
  api.get('/me', async (c) => {
    const admin = c.get('admin');
    return ok(c, { email: admin.email });
  });

  /**
   * All projects. Single-admin product, so there's no membership
   * filter — the founder sees every project they've created.
   */
  api.get('/projects', async (c) => {
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
      })
      .from(schema.projects)
      .orderBy(desc(schema.projects.createdAt));

    return ok(c, rows);
  });

  /**
   * Cross-project KPI landing. One row per project, counters are
   * pre-aggregated in SQL so the dashboard pays a single round-trip.
   *
   * Left-joining `ticket_votes` multiplies voted-ticket rows, so ticket
   * counters use `count(DISTINCT tickets.id) FILTER (…)` to collapse
   * duplicates; the vote counter itself wants the row count and so
   * skips DISTINCT.
   */
  api.get('/overview', async (c) => {
    const rows = await db
      .select({
        id: schema.projects.id,
        key: schema.projects.key,
        name: schema.projects.name,
        accentColor: schema.projects.accentColor,
        openBugs: sql<number>`count(distinct ${schema.tickets.id}) filter (where ${schema.tickets.kind} = 'bug' and ${schema.tickets.status} = 'open')::int`,
        openFeatures: sql<number>`count(distinct ${schema.tickets.id}) filter (where ${schema.tickets.kind} = 'feature' and ${schema.tickets.status} = 'open')::int`,
        openFeatureVotes: sql<number>`count(${schema.ticketVotes.ticketId}) filter (where ${schema.tickets.kind} = 'feature' and ${schema.tickets.status} = 'open')::int`,
      })
      .from(schema.projects)
      .leftJoin(schema.tickets, eq(schema.tickets.projectId, schema.projects.id))
      .leftJoin(schema.ticketVotes, eq(schema.ticketVotes.ticketId, schema.tickets.id))
      .groupBy(schema.projects.id)
      .orderBy(schema.projects.name);

    return ok(c, {
      projects: rows.map((r) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        accentColor: r.accentColor,
        kpis: {
          openBugs: r.openBugs,
          openFeatures: r.openFeatures,
          openFeatureVotes: r.openFeatureVotes,
        },
      })),
    });
  });

  const createProjectSchema = z.object({
    name: z.string().trim().min(1).max(120),
    key: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9-]+$/, 'key must match /^[a-z0-9-]+$/'),
    allowedOrigins: z.array(z.string().trim().min(1).max(512)).max(20).optional(),
    requireIdentityVerification: z.boolean().optional(),
  });

  /**
   * Create a project. Returns the plaintext `identitySecret` once —
   * the server encrypts it at rest and never returns it again.
   */
  api.post('/projects', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createProjectSchema.safeParse(body);
    if (!parsed.success) {
      return fail(c, 'validation_failed', 'Invalid project payload', 422, {
        issues: parsed.error.issues,
      });
    }
    const { name, key, allowedOrigins, requireIdentityVerification } = parsed.data;

    const [existing] = await db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(eq(schema.projects.key, key))
      .limit(1);
    if (existing) {
      return fail(c, 'conflict', `A project with key "${key}" already exists`, 409);
    }

    const identitySecret = randomBytes(32).toString('hex');
    const storedSecret = getSecretStoreFromEnv().encrypt(identitySecret);

    const [created] = await db
      .insert(schema.projects)
      .values({
        name,
        key,
        allowedOrigins: allowedOrigins ?? [],
        identitySecret: storedSecret,
        requireIdentityVerification: requireIdentityVerification ?? false,
      })
      .returning();
    const project = firstOrThrow(created ? [created] : [], 'project after insert');

    return ok(
      c,
      {
        project: {
          id: project.id,
          key: project.key,
          name: project.name,
          accentColor: project.accentColor,
          allowedOrigins: project.allowedOrigins,
          requireIdentityVerification: project.requireIdentityVerification,
          lastPingAt: project.lastPingAt,
          lastPingOrigin: project.lastPingOrigin,
          createdAt: project.createdAt,
        },
        identitySecret,
      },
      201,
    );
  });

  /**
   * Resolve `:key` → project id + key. Replaces the team-era
   * `requireProjectMember`: there's no membership to check, only
   * existence. Returns 404 on miss.
   */
  const resolveProject: MiddlewareHandler<{
    Variables: AdminContext & { project: { id: string; key: string } };
  }> = async (c, next) => {
    const key = c.req.param('key');
    if (!key) return fail(c, 'not_found', 'Project not found', 404);
    const [row] = await db
      .select({ id: schema.projects.id, key: schema.projects.key })
      .from(schema.projects)
      .where(eq(schema.projects.key, key))
      .limit(1);
    if (!row) return fail(c, 'not_found', 'Project not found', 404);
    c.set('project', row);
    await next();
  };

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
    sort: z.enum(['recent', 'votes']).default('recent').optional(),
  });

  /**
   * Cursor format: `${isoCreatedAt}|${ticketId}`, base64url-encoded.
   * Sort is `(created_at desc, id desc)` — the cursor predicate is
   * `(created_at, id) < (cursorCreatedAt, cursorId)`.
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

  api.get('/projects/:key/tickets', resolveProject, async (c) => {
    const project = c.get('project');
    const queryResult = ticketQuerySchema.safeParse({
      kind: c.req.query('kind'),
      status: c.req.query('status'),
      priority: c.req.query('priority'),
      verified: c.req.query('verified'),
      search: c.req.query('search'),
      limit: c.req.query('limit'),
      cursor: c.req.query('cursor'),
      sort: c.req.query('sort'),
    });
    if (!queryResult.success) {
      return fail(c, 'validation_failed', 'Invalid query parameters', 422, {
        issues: queryResult.error.issues,
      });
    }
    const { kind, status, priority, verified, search, limit, cursor, sort } =
      queryResult.data;

    // Features tab fits on one page at operator scale; skip the extra
    // work of a votes-aware cursor predicate.
    if (sort === 'votes' && cursor) {
      return fail(c, 'validation_failed', 'cursor not supported with sort=votes', 422);
    }

    const conditions = [eq(schema.tickets.projectId, project.id)];
    if (kind) conditions.push(eq(schema.tickets.kind, kind));
    if (status) conditions.push(eq(schema.tickets.status, status));
    if (priority) conditions.push(eq(schema.tickets.priority, priority));
    if (verified) conditions.push(eq(schema.tickets.reporterVerified, verified === 'true'));
    if (search) {
      const needle = `%${search.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`;
      conditions.push(
        or(
          sql`${schema.tickets.title} ilike ${needle}`,
          sql`${schema.tickets.description} ilike ${needle}`,
          sql`${schema.tickets.reporterEmail} ilike ${needle}`,
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

    const voteCountExpr = sql<number>`count(${schema.ticketVotes.ticketId})::int`;

    const rows = await db
      .select({
        ticket: schema.tickets,
        voteCount: voteCountExpr,
      })
      .from(schema.tickets)
      .leftJoin(schema.ticketVotes, eq(schema.ticketVotes.ticketId, schema.tickets.id))
      .where(and(...conditions))
      .groupBy(schema.tickets.id)
      .orderBy(
        ...(sort === 'votes'
          ? [desc(voteCountExpr), desc(schema.tickets.createdAt), desc(schema.tickets.id)]
          : [desc(schema.tickets.createdAt), desc(schema.tickets.id)]),
      )
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

  /**
   * Triage mutation. Partial update: both fields optional, at least one
   * required. We don't expose other columns on purpose — things like
   * `reporter_email` and `metadata` come from the submitter and must
   * not be rewritable here. Notes are a separate surface.
   */
  const patchTicketSchema = z
    .object({
      status: ticketStatusSchema.optional(),
      priority: ticketPrioritySchema.optional(),
    })
    .refine((v) => v.status !== undefined || v.priority !== undefined, {
      message: 'At least one of status or priority is required',
    });

  api.patch('/projects/:key/tickets/:id', resolveProject, async (c) => {
    const project = c.get('project');
    const id = c.req.param('id');

    const body = await c.req.json().catch(() => null);
    const parsed = patchTicketSchema.safeParse(body);
    if (!parsed.success) {
      return fail(c, 'validation_failed', 'Invalid patch payload', 422, {
        issues: parsed.error.issues,
      });
    }

    const result = await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(schema.tickets)
        .where(
          and(eq(schema.tickets.id, id), eq(schema.tickets.projectId, project.id)),
        )
        .limit(1);
      if (!before) return { notFound: true } as const;

      const updated = await tx
        .update(schema.tickets)
        .set({
          ...(parsed.data.status ? { status: parsed.data.status } : {}),
          ...(parsed.data.priority ? { priority: parsed.data.priority } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(eq(schema.tickets.id, id), eq(schema.tickets.projectId, project.id)),
        )
        .returning();
      const after = firstOrThrow(updated, 'ticket after update');

      const events: Array<{
        ticketId: string;
        kind: 'status_changed' | 'priority_changed';
        payload: Record<string, unknown>;
      }> = [];
      if (parsed.data.status && parsed.data.status !== before.status) {
        events.push({
          ticketId: id,
          kind: 'status_changed',
          payload: { from: before.status, to: parsed.data.status },
        });
      }
      if (parsed.data.priority && parsed.data.priority !== before.priority) {
        events.push({
          ticketId: id,
          kind: 'priority_changed',
          payload: { from: before.priority, to: parsed.data.priority },
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

    const voteCountExpr = sql<number>`count(${schema.ticketVotes.ticketId})::int`;
    const [withVotes] = await db
      .select({ ticket: schema.tickets, voteCount: voteCountExpr })
      .from(schema.tickets)
      .leftJoin(schema.ticketVotes, eq(schema.ticketVotes.ticketId, schema.tickets.id))
      .where(eq(schema.tickets.id, id))
      .groupBy(schema.tickets.id);

    const row = firstOrThrow(withVotes ? [withVotes] : []);
    return ok(c, { ...row.ticket, voteCount: row.voteCount });
  });

  /** Audit trail for a ticket. Read-only. */
  api.get('/projects/:key/tickets/:id/events', resolveProject, async (c) => {
    const project = c.get('project');
    const id = c.req.param('id');

    const [ticket] = await db
      .select({ id: schema.tickets.id })
      .from(schema.tickets)
      .where(and(eq(schema.tickets.id, id), eq(schema.tickets.projectId, project.id)))
      .limit(1);
    if (!ticket) return fail(c, 'not_found', 'Ticket not found', 404);

    const rows = await db
      .select({
        id: schema.adminTicketEvents.id,
        ticketId: schema.adminTicketEvents.ticketId,
        kind: schema.adminTicketEvents.kind,
        payload: schema.adminTicketEvents.payload,
        createdAt: schema.adminTicketEvents.createdAt,
        batchId: schema.adminTicketEvents.batchId,
      })
      .from(schema.adminTicketEvents)
      .where(eq(schema.adminTicketEvents.ticketId, id))
      .orderBy(desc(schema.adminTicketEvents.createdAt))
      .limit(200);

    return ok(c, rows);
  });

  /** Triage notes on a ticket. */
  api.get('/projects/:key/tickets/:id/comments', resolveProject, async (c) => {
    const project = c.get('project');
    const id = c.req.param('id');

    const [ticket] = await db
      .select({ id: schema.tickets.id })
      .from(schema.tickets)
      .where(and(eq(schema.tickets.id, id), eq(schema.tickets.projectId, project.id)))
      .limit(1);
    if (!ticket) return fail(c, 'not_found', 'Ticket not found', 404);

    const rows = await db
      .select({
        id: schema.adminTicketComments.id,
        ticketId: schema.adminTicketComments.ticketId,
        body: schema.adminTicketComments.body,
        createdAt: schema.adminTicketComments.createdAt,
      })
      .from(schema.adminTicketComments)
      .where(eq(schema.adminTicketComments.ticketId, id))
      .orderBy(desc(schema.adminTicketComments.createdAt))
      .limit(200);

    return ok(c, rows);
  });

  const createCommentSchema = z.object({
    body: z.string().trim().min(1).max(10_000),
  });

  api.post('/projects/:key/tickets/:id/comments', resolveProject, async (c) => {
    const project = c.get('project');
    const id = c.req.param('id');

    const body = await c.req.json().catch(() => null);
    const parsed = createCommentSchema.safeParse(body);
    if (!parsed.success) {
      return fail(c, 'validation_failed', 'Invalid comment payload', 422, {
        issues: parsed.error.issues,
      });
    }

    const created = await db.transaction(async (tx) => {
      const [ticket] = await tx
        .select({ id: schema.tickets.id })
        .from(schema.tickets)
        .where(and(eq(schema.tickets.id, id), eq(schema.tickets.projectId, project.id)))
        .limit(1);
      if (!ticket) return { notFound: true } as const;

      const [row] = await tx
        .insert(schema.adminTicketComments)
        .values({ ticketId: id, body: parsed.data.body })
        .returning();
      const comment = firstOrThrow(row ? [row] : [], 'comment after insert');

      const excerpt = comment.body.slice(0, 200);
      await tx.insert(schema.adminTicketEvents).values({
        ticketId: id,
        kind: 'commented',
        payload: { commentId: comment.id, excerpt },
      });

      return { notFound: false, comment } as const;
    });

    if (created.notFound) return fail(c, 'not_found', 'Ticket not found', 404);
    return ok(c, created.comment, 201);
  });

  /**
   * Bulk PATCH — apply the same status/priority change to up to 100
   * tickets at once. Same audit shape as the single PATCH; events
   * share a `batchId` so the dashboard can offer "undo this batch".
   */
  const bulkPatchSchema = z.object({
    ids: z.array(z.string().uuid()).min(1).max(100),
    patch: z
      .object({
        status: ticketStatusSchema.optional(),
        priority: ticketPrioritySchema.optional(),
      })
      .refine((v) => v.status !== undefined || v.priority !== undefined, {
        message: 'At least one of status or priority is required',
      }),
  });

  api.post('/projects/:key/tickets/bulk', resolveProject, async (c) => {
    const project = c.get('project');

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
      const before = await tx
        .select()
        .from(schema.tickets)
        .where(
          and(eq(schema.tickets.projectId, project.id), inArray(schema.tickets.id, ids)),
        );
      const beforeById = new Map(before.map((t) => [t.id, t]));
      const failed: Failure[] = ids
        .filter((id) => !beforeById.has(id))
        .map((id) => ({ id, reason: 'not_found' }));

      if (before.length === 0) {
        return { updatedCount: 0, failed, batchId: null } as const;
      }

      const updated = await tx
        .update(schema.tickets)
        .set({
          ...(patch.status ? { status: patch.status } : {}),
          ...(patch.priority ? { priority: patch.priority } : {}),
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

      const batchId = randomUUID();

      const events: Array<{
        ticketId: string;
        kind: 'status_changed' | 'priority_changed';
        payload: Record<string, unknown>;
        batchId: string;
      }> = [];
      for (const row of before) {
        if (patch.status && patch.status !== row.status) {
          events.push({
            ticketId: row.id,
            kind: 'status_changed',
            payload: { from: row.status, to: patch.status },
            batchId,
          });
        }
        if (patch.priority && patch.priority !== row.priority) {
          events.push({
            ticketId: row.id,
            kind: 'priority_changed',
            payload: { from: row.priority, to: patch.priority },
            batchId,
          });
        }
      }
      if (events.length > 0) {
        await tx.insert(schema.adminTicketEvents).values(events);
      }

      return {
        updatedCount: updated.length,
        failed,
        batchId: events.length > 0 ? batchId : null,
      } as const;
    });

    return ok(c, {
      updated: result.updatedCount,
      failed: result.failed,
      batchId: result.batchId,
    });
  });

  /**
   * Revert a single audit event. Rewinds the ticket field to the
   * event's `from` value and emits a new event capturing the delta.
   */
  api.post(
    '/projects/:key/tickets/:id/events/:eventId/revert',
    resolveProject,
    async (c) => {
      const project = c.get('project');
      const ticketId = c.req.param('id');
      const eventId = c.req.param('eventId');

      const outcome = await db.transaction(async (tx) => {
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

        let nextField:
          | { column: 'status'; value: TicketStatus; currentValue: TicketStatus }
          | { column: 'priority'; value: TicketPriority; currentValue: TicketPriority }
          | null = null;

        if (event.kind === 'status_changed') {
          const from = typeof payload.from === 'string' ? payload.from : null;
          if (from && isTicketStatus(from)) {
            nextField = { column: 'status', value: from, currentValue: ticket.status };
          }
        } else if (event.kind === 'priority_changed') {
          const from = typeof payload.from === 'string' ? payload.from : null;
          if (from && isTicketPriority(from)) {
            nextField = { column: 'priority', value: from, currentValue: ticket.priority };
          }
        }

        if (!nextField) return { kind: 'unrevertable' } as const;
        if (nextField.value === nextField.currentValue) {
          return { kind: 'noop', ticket } as const;
        }

        await tx
          .update(schema.tickets)
          .set({
            ...(nextField.column === 'status' ? { status: nextField.value } : {}),
            ...(nextField.column === 'priority' ? { priority: nextField.value } : {}),
            updatedAt: new Date(),
          })
          .where(eq(schema.tickets.id, ticketId));

        await tx.insert(schema.adminTicketEvents).values({
          ticketId,
          kind: event.kind,
          payload: {
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
        return fail(c, 'validation_failed', 'This event kind cannot be reverted', 422);
      }

      const voteCountExpr = sql<number>`count(${schema.ticketVotes.ticketId})::int`;
      const [withVotes] = await db
        .select({ ticket: schema.tickets, voteCount: voteCountExpr })
        .from(schema.tickets)
        .leftJoin(schema.ticketVotes, eq(schema.ticketVotes.ticketId, schema.tickets.id))
        .where(eq(schema.tickets.id, ticketId))
        .groupBy(schema.tickets.id);

      const row = firstOrThrow(withVotes ? [withVotes] : []);
      return ok(c, { ...row.ticket, voteCount: row.voteCount });
    },
  );

  /** Recent bulk actions for the project. Sorted newest-first. */
  api.get('/projects/:key/events/batches', resolveProject, async (c) => {
    const project = c.get('project');

    const rows = (await db.execute(sql`
      with grouped as (
        select
          e.batch_id                           as batch_id,
          min(e.created_at)                    as created_at,
          count(*)::int                        as event_count,
          count(distinct e.ticket_id)::int     as ticket_count,
          array_agg(distinct e.kind::text)     as kinds
        from admin_ticket_events e
        join tickets t on t.id = e.ticket_id
        where e.batch_id is not null
          and t.project_id = ${project.id}
        group by e.batch_id
      )
      select batch_id, created_at, event_count, ticket_count, kinds
      from grouped
      order by created_at desc
      limit 50
    `)) as unknown as Array<{
      batch_id: string;
      created_at: Date;
      event_count: number;
      ticket_count: number;
      kinds: string[];
    }>;

    return ok(
      c,
      rows.map((r) => ({
        batchId: r.batch_id,
        createdAt: r.created_at,
        eventCount: r.event_count,
        ticketCount: r.ticket_count,
        kinds: r.kinds,
      })),
    );
  });

  /** Revert every event sharing a `batchId`. */
  api.post('/projects/:key/events/batches/:batchId/revert', resolveProject, async (c) => {
    const project = c.get('project');
    const batchId = c.req.param('batchId');

    const outcome = await db.transaction(async (tx) => {
      const events = await tx
        .select({ event: schema.adminTicketEvents, ticket: schema.tickets })
        .from(schema.adminTicketEvents)
        .innerJoin(
          schema.tickets,
          eq(schema.tickets.id, schema.adminTicketEvents.ticketId),
        )
        .where(
          and(
            eq(schema.adminTicketEvents.batchId, batchId),
            eq(schema.tickets.projectId, project.id),
          ),
        )
        .orderBy(desc(schema.adminTicketEvents.createdAt));

      type Skip = { eventId: string; reason: string };
      const skipped: Skip[] = [];
      let reverted = 0;

      const currentState = new Map<
        string,
        { status: TicketStatus; priority: TicketPriority }
      >();
      for (const { ticket } of events) {
        if (!currentState.has(ticket.id)) {
          currentState.set(ticket.id, {
            status: ticket.status,
            priority: ticket.priority,
          });
        }
      }

      for (const { event } of events) {
        const state = currentState.get(event.ticketId)!;
        const payload = event.payload as Record<string, unknown>;

        let update:
          | { column: 'status'; value: TicketStatus }
          | { column: 'priority'; value: TicketPriority }
          | null = null;

        if (event.kind === 'status_changed') {
          const from = typeof payload.from === 'string' ? payload.from : null;
          if (from && isTicketStatus(from)) update = { column: 'status', value: from };
        } else if (event.kind === 'priority_changed') {
          const from = typeof payload.from === 'string' ? payload.from : null;
          if (from && isTicketPriority(from)) update = { column: 'priority', value: from };
        }

        if (!update) {
          skipped.push({ eventId: event.id, reason: 'unrevertable' });
          continue;
        }

        const currentValue = state[update.column];
        if (currentValue === update.value) {
          skipped.push({ eventId: event.id, reason: 'no_change' });
          continue;
        }

        await tx
          .update(schema.tickets)
          .set({
            ...(update.column === 'status' ? { status: update.value } : {}),
            ...(update.column === 'priority' ? { priority: update.value } : {}),
            updatedAt: new Date(),
          })
          .where(eq(schema.tickets.id, event.ticketId));

        await tx.insert(schema.adminTicketEvents).values({
          ticketId: event.ticketId,
          kind: event.kind,
          payload: {
            from: currentValue,
            to: update.value,
            revertOf: event.id,
          },
        });

        if (update.column === 'status') state.status = update.value;
        else state.priority = update.value;
        reverted += 1;
      }

      return { reverted, skipped } as const;
    });

    return ok(c, outcome);
  });

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
