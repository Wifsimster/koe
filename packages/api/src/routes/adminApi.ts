import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { and, desc, eq, sql } from 'drizzle-orm';
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

  const ticketQuerySchema = z.object({
    kind: z.enum(['bug', 'feature']).optional(),
    status: z.enum(['open', 'in_progress', 'planned', 'resolved', 'closed', 'wont_fix']).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  });

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
      limit: c.req.query('limit'),
    });
    if (!queryResult.success) {
      return fail(c, 'validation_failed', 'Invalid query parameters', 422, {
        issues: queryResult.error.issues,
      });
    }
    const { kind, status, limit } = queryResult.data;

    const conditions = [eq(schema.tickets.projectId, project.id)];
    if (kind) conditions.push(eq(schema.tickets.kind, kind));
    if (status) conditions.push(eq(schema.tickets.status, status));

    // Vote count is a left-join aggregate — same pattern as the widget
    // roadmap read; no denormalized counter to drift out of sync.
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
      .orderBy(desc(schema.tickets.createdAt))
      .limit(limit);

    return ok(c, rows.map((r) => ({ ...r.ticket, voteCount: r.voteCount })));
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
    })
    .refine(
      (v) => v.status !== undefined || v.priority !== undefined,
      { message: 'At least one of status or priority is required' },
    );

  api.patch(
    '/projects/:key/tickets/:id',
    requireProjectMember,
    requireProjectWriter,
    async (c) => {
      const project = c.get('project');
      const id = c.req.param('id');

      const body = await c.req.json().catch(() => null);
      const parsed = patchTicketSchema.safeParse(body);
      if (!parsed.success) {
        return fail(c, 'validation_failed', 'Invalid patch payload', 422, {
          issues: parsed.error.issues,
        });
      }

      // Scope the update to `(project_id, id)` so a caller can't mutate
      // a ticket that belongs to another project by passing its id in
      // the URL. Returning rows lets us distinguish "not found" from
      // "not yours" — same 404 either way.
      const updated = await db
        .update(schema.tickets)
        .set({
          ...(parsed.data.status ? { status: parsed.data.status } : {}),
          ...(parsed.data.priority ? { priority: parsed.data.priority } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.tickets.id, id),
            eq(schema.tickets.projectId, project.id),
          ),
        )
        .returning();

      if (updated.length === 0) {
        return fail(c, 'not_found', 'Ticket not found', 404);
      }

      // Re-read with the aggregate vote count so the dashboard gets
      // the same shape it receives from the list endpoint.
      const voteCountExpr = sql<number>`count(${schema.ticketVotes.ticketId})::int`;
      const [withVotes] = await db
        .select({
          ticket: schema.tickets,
          voteCount: voteCountExpr,
        })
        .from(schema.tickets)
        .leftJoin(schema.ticketVotes, eq(schema.ticketVotes.ticketId, schema.tickets.id))
        .where(eq(schema.tickets.id, id))
        .groupBy(schema.tickets.id);

      const row = firstOrThrow(withVotes ? [withVotes] : []);
      return ok(c, { ...row.ticket, voteCount: row.voteCount });
    },
  );

  return api;
}
