import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import {
  isTicketPriority,
  isTicketStatus,
  type TicketPriority,
  type TicketStatus,
} from '@koe/shared';
import { db, firstOrThrow, schema } from '../db';
import { voteCountExpr } from '../db/queries';
import { ok, fail } from '../lib/response';
import {
  bulkPatchSchema,
  createProjectSchema,
  patchTicketSchema,
  testEmailSchema,
  ticketQuerySchema,
} from '../lib/schemas';
import { parseJsonBody, validateOrFail } from '../lib/validation';
import { getSecretStoreFromEnv } from '../lib/secretStore';
import { sendTestEmail } from '../lib/notifications';
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
   * Reports the current Resend configuration so the dashboard's
   * "email setup" panel can show what's missing before the operator
   * tries to send a test. Only booleans + the resolved (env-derived)
   * sender / recipient strings — never the API key itself.
   */
  api.get('/notifications/email', async (c) => {
    const apiKeySet = !!process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL?.trim() || null;
    const ownerEmail = process.env.NOTIFY_OWNER_EMAIL?.trim() || null;
    const adminEmail = process.env.ADMIN_EMAIL?.trim() || null;
    const recipient = ownerEmail ?? adminEmail;
    return ok(c, {
      apiKeySet,
      from,
      recipient,
      recipientSource: ownerEmail ? 'NOTIFY_OWNER_EMAIL' : adminEmail ? 'ADMIN_EMAIL' : null,
      ready: apiKeySet && !!from && !!recipient,
    });
  });

  /**
   * Sends a one-off test email so the operator can verify Resend is
   * reachable from this deploy without waiting for a real submission.
   * Optional `to` lets them probe a personal inbox instead of the
   * configured owner address.
   *
   * Maps the structured `TestEmailResult` to canonical envelopes:
   * misconfiguration → 422, Resend rejection → 502, success → 200.
   */
  api.post('/notifications/email/test', async (c) => {
    // Empty body is valid (no `to` override); only parse when we
    // actually have JSON to consume so the dashboard can fire an
    // empty POST without setting a Content-Type.
    let to: string | undefined;
    const raw = await c.req.text();
    if (raw.trim().length > 0) {
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        return fail(c, 'validation_failed', 'Body must be valid JSON', 422);
      }
      const parsed = validateOrFail(c, testEmailSchema, body, 'Invalid test email payload');
      if (!parsed.ok) return parsed.response;
      to = parsed.data.to;
    }

    const result = await sendTestEmail({ to });
    if (result.ok) {
      return ok(c, {
        sent: true,
        to: result.to,
        from: result.from,
        messageId: result.messageId,
      });
    }
    if (result.reason === 'send_failed') {
      return fail(
        c,
        'service_unavailable',
        result.detail ?? 'Resend rejected the request',
        502,
        { reason: result.reason },
      );
    }
    const messages = {
      no_api_key: 'RESEND_API_KEY is not set on the server',
      no_sender: 'RESEND_FROM_EMAIL is not set on the server',
      no_recipient:
        'No recipient configured — set NOTIFY_OWNER_EMAIL or pass a `to` field in the body',
    } as const;
    return fail(c, 'validation_failed', messages[result.reason], 422, {
      reason: result.reason,
    });
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

  /**
   * Create a project. Returns the plaintext `identitySecret` once —
   * the server encrypts it at rest and never returns it again.
   */
  api.post('/projects', async (c) => {
    const parsed = await parseJsonBody(c, createProjectSchema, 'Invalid project payload');
    if (!parsed.ok) return parsed.response;
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
    const queryResult = validateOrFail(
      c,
      ticketQuerySchema,
      {
        kind: c.req.query('kind'),
        status: c.req.query('status'),
        priority: c.req.query('priority'),
        verified: c.req.query('verified'),
        search: c.req.query('search'),
        limit: c.req.query('limit'),
        cursor: c.req.query('cursor'),
        sort: c.req.query('sort'),
      },
      'Invalid query parameters',
    );
    if (!queryResult.ok) return queryResult.response;
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

  api.patch('/projects/:key/tickets/:id', resolveProject, async (c) => {
    const project = c.get('project');
    const id = c.req.param('id');

    const parsed = await parseJsonBody(c, patchTicketSchema, 'Invalid patch payload');
    if (!parsed.ok) return parsed.response;

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
          // Normalise "" -> null so a cleared textarea doesn't persist
          // an empty string that sorts different from "never written".
          ...(parsed.data.notes !== undefined
            ? { notes: parsed.data.notes ? parsed.data.notes : null }
            : {}),
          ...(parsed.data.isPublicRoadmap !== undefined
            ? { isPublicRoadmap: parsed.data.isPublicRoadmap }
            : {}),
          updatedAt: new Date(),
        })
        .where(
          and(eq(schema.tickets.id, id), eq(schema.tickets.projectId, project.id)),
        )
        .returning();
      const after = firstOrThrow(updated, 'ticket after update');

      const events: Array<{
        ticketId: string;
        kind: 'status_changed' | 'priority_changed' | 'roadmap_toggled';
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
      if (
        parsed.data.isPublicRoadmap !== undefined &&
        parsed.data.isPublicRoadmap !== before.isPublicRoadmap
      ) {
        events.push({
          ticketId: id,
          kind: 'roadmap_toggled',
          payload: { from: before.isPublicRoadmap, to: parsed.data.isPublicRoadmap },
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
      })
      .from(schema.adminTicketEvents)
      .where(eq(schema.adminTicketEvents.ticketId, id))
      .orderBy(desc(schema.adminTicketEvents.createdAt))
      .limit(200);

    return ok(c, rows);
  });

  /**
   * Bulk PATCH — apply the same status/priority change to up to 100
   * tickets at once. Same audit shape as the single PATCH: per-ticket
   * events emitted independently. No batch correlation: a solo
   * operator knows what they just bulk-changed; per-event undo on the
   * timeline covers mistakes.
   */
  api.post('/projects/:key/tickets/bulk', resolveProject, async (c) => {
    const project = c.get('project');

    const parsed = await parseJsonBody(c, bulkPatchSchema, 'Invalid bulk payload');
    if (!parsed.ok) return parsed.response;
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
        return { updatedCount: 0, failed } as const;
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

      const events: Array<{
        ticketId: string;
        kind: 'status_changed' | 'priority_changed';
        payload: Record<string, unknown>;
      }> = [];
      for (const row of before) {
        if (patch.status && patch.status !== row.status) {
          events.push({
            ticketId: row.id,
            kind: 'status_changed',
            payload: { from: row.status, to: patch.status },
          });
        }
        if (patch.priority && patch.priority !== row.priority) {
          events.push({
            ticketId: row.id,
            kind: 'priority_changed',
            payload: { from: row.priority, to: patch.priority },
          });
        }
      }
      if (events.length > 0) {
        await tx.insert(schema.adminTicketEvents).values(events);
      }

      return { updatedCount: updated.length, failed } as const;
    });

    return ok(c, {
      updated: result.updatedCount,
      failed: result.failed,
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
          | { column: 'isPublicRoadmap'; value: boolean; currentValue: boolean }
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
        } else if (event.kind === 'roadmap_toggled') {
          const from = typeof payload.from === 'boolean' ? payload.from : null;
          if (from !== null) {
            nextField = {
              column: 'isPublicRoadmap',
              value: from,
              currentValue: ticket.isPublicRoadmap,
            };
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
            ...(nextField.column === 'isPublicRoadmap'
              ? { isPublicRoadmap: nextField.value }
              : {}),
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

  return api;
}
