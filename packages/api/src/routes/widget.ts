import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, firstOrThrow, schema } from '../db';
import { voteCountExpr } from '../db/queries';
import { ok, fail } from '../lib/response';
import {
  createBugSchema,
  createFeatureSchema,
  myRequestsQuerySchema,
  voteSchema,
} from '../lib/schemas';
import { parseJsonBody, validateOrFail } from '../lib/validation';
import { requireProject, type ProjectContext } from '../middleware/project';
import { attachVerifier, type VerifyReporterFn } from '../middleware/identity';
import { widgetCors } from '../middleware/cors';
import { clientIp, createRateLimiterFromEnv, rateLimit } from '../middleware/rateLimit';

/** 256 KB hard cap on any widget payload. Screenshots go through a
 *  presigned upload flow, never inline base64 (see `screenshotUrl`). */
const MAX_BODY_BYTES = 256 * 1024;

type WidgetVariables = ProjectContext & { verifyReporter: VerifyReporterFn };

export const widgetRoutes = new Hono<{ Variables: WidgetVariables }>();

widgetRoutes.use('*', widgetCors);
widgetRoutes.use('*', bodyLimit({ maxSize: MAX_BODY_BYTES }));

// Rate limit before DB work — cheap rejection for floods. 10 req/min
// with a 30-request burst, keyed on (project key, client IP). The
// project key is used before `requireProject` runs, so unknown keys
// still get rate-limited by header value (preventing brute-force
// enumeration).
//
// `createRateLimiterFromEnv` picks Redis if `REDIS_URL` is set so the
// bucket is shared across replicas — critical, because an in-memory
// bucket per pod multiplies the effective rate by the replica count.
const widgetRateLimiter = createRateLimiterFromEnv({
  refillPerSecond: 10 / 60,
  capacity: 30,
  prefix: 'koe:rl:widget:',
});
widgetRoutes.use(
  '*',
  rateLimit({
    refillPerSecond: 10 / 60,
    capacity: 30,
    limiter: widgetRateLimiter,
    key: (c) => {
      const key = c.req.header('X-Koe-Project-Key') ?? 'unknown';
      const ip = clientIp(c);
      return `${key}:${ip}`;
    },
  }),
);

widgetRoutes.use('*', requireProject);
widgetRoutes.use('*', attachVerifier);

widgetRoutes.post('/bugs', async (c) => {
  const parsed = await parseJsonBody(c, createBugSchema, 'Invalid bug report payload');
  if (!parsed.ok) return parsed.response;
  const input = parsed.data;
  const project = c.get('project');

  const verdict = await c.get('verifyReporter')(input.reporter.id);
  if (!verdict.ok) return fail(c, 'unauthorized', verdict.reason, 401);

  const row = firstOrThrow(
    await db
      .insert(schema.tickets)
      .values({
        projectId: project.id,
        kind: 'bug',
        title: input.title,
        description: input.description,
        stepsToReproduce: input.stepsToReproduce,
        expectedBehavior: input.expectedBehavior,
        actualBehavior: input.actualBehavior,
        reporterId: input.reporter.id,
        reporterName: input.reporter.name,
        reporterEmail: input.reporter.email,
        reporterVerified: verdict.verified,
        metadata: input.metadata,
        screenshotUrl: input.screenshotUrl,
      })
      .returning(),
  );

  return ok(c, row, 201);
});

widgetRoutes.post('/features', async (c) => {
  const parsed = await parseJsonBody(c, createFeatureSchema, 'Invalid feature request payload');
  if (!parsed.ok) return parsed.response;
  const input = parsed.data;
  const project = c.get('project');

  const verdict = await c.get('verifyReporter')(input.reporter.id);
  if (!verdict.ok) return fail(c, 'unauthorized', verdict.reason, 401);

  const row = firstOrThrow(
    await db
      .insert(schema.tickets)
      .values({
        projectId: project.id,
        kind: 'feature',
        title: input.title,
        description: input.description,
        reporterId: input.reporter.id,
        reporterName: input.reporter.name,
        reporterEmail: input.reporter.email,
        reporterVerified: verdict.verified,
        metadata: input.metadata,
      })
      .returning(),
  );

  return ok(c, { ...row, voteCount: 0, hasVoted: false }, 201);
});

/**
 * Public roadmap read. Vote counts are derived via aggregate — no
 * denormalized counter to drift out of sync.
 */
widgetRoutes.get('/features', async (c) => {
  const project = c.get('project');
  const currentUserId = c.req.query('userId') ?? null;

  const hasVotedExpr = currentUserId
    ? sql<boolean>`bool_or(${schema.ticketVotes.userId} = ${currentUserId})`
    : sql<boolean>`false`;

  const rows = await db
    .select({
      ticket: schema.tickets,
      voteCount: voteCountExpr,
      hasVoted: hasVotedExpr,
    })
    .from(schema.tickets)
    .leftJoin(schema.ticketVotes, eq(schema.ticketVotes.ticketId, schema.tickets.id))
    .where(and(eq(schema.tickets.projectId, project.id), eq(schema.tickets.kind, 'feature')))
    .groupBy(schema.tickets.id)
    .orderBy(desc(voteCountExpr), desc(schema.tickets.createdAt))
    .limit(100);

  return ok(
    c,
    rows.map((r) => ({ ...r.ticket, voteCount: r.voteCount, hasVoted: r.hasVoted })),
  );
});

/**
 * Toggle a vote. The `(ticket_id, user_id)` primary key makes this
 * idempotent and race-free at the database level.
 */
widgetRoutes.post('/features/:id/vote', async (c) => {
  const project = c.get('project');
  const id = c.req.param('id');
  const parsed = await parseJsonBody(c, voteSchema, 'userId is required');
  if (!parsed.ok) return parsed.response;
  const { userId } = parsed.data;

  const verdict = await c.get('verifyReporter')(userId);
  if (!verdict.ok) return fail(c, 'unauthorized', verdict.reason, 401);

  const [ticket] = await db
    .select()
    .from(schema.tickets)
    .where(and(eq(schema.tickets.id, id), eq(schema.tickets.projectId, project.id)));

  if (!ticket || ticket.kind !== 'feature') {
    return fail(c, 'not_found', 'Feature request not found', 404);
  }

  // Try to insert; if the composite PK already exists it's a toggle-off.
  const inserted = await db
    .insert(schema.ticketVotes)
    .values({ ticketId: id, userId })
    .onConflictDoNothing()
    .returning();

  let hasVoted: boolean;
  if (inserted.length === 0) {
    await db
      .delete(schema.ticketVotes)
      .where(and(eq(schema.ticketVotes.ticketId, id), eq(schema.ticketVotes.userId, userId)));
    hasVoted = false;
  } else {
    hasVoted = true;
  }

  const countRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.ticketVotes)
    .where(eq(schema.ticketVotes.ticketId, id));
  const voteCount = countRows[0]?.count ?? 0;

  return ok(c, { ...ticket, voteCount, hasVoted });
});

/**
 * List tickets authored by the caller ("my requests"). The widget shows
 * these in a dedicated tab so users can follow the status of what they
 * submitted without needing an account.
 *
 * Scoping: `reporterId = userId AND projectId = currentProject`. The
 * reporter id is always validated by `verifyReporter` — when the project
 * requires identity verification, unsigned calls return 401 (same posture
 * as `/features/:id/vote`). When verification is optional, we still trust
 * the `userId` query param; operators running public-facing sites should
 * flip `requireIdentityVerification=true` to block enumeration.
 *
 * Response is a deliberate projection — no `reporterEmail`, `metadata`,
 * `screenshotUrl`, or `notes`. Those are admin-side concerns and have no
 * business round-tripping through a widget response.
 */
widgetRoutes.get('/my-requests', async (c) => {
  const project = c.get('project');
  const parsed = validateOrFail(
    c,
    myRequestsQuerySchema,
    { userId: c.req.query('userId'), limit: c.req.query('limit') },
    'userId is required',
  );
  if (!parsed.ok) return parsed.response;
  const { userId, limit } = parsed.data;

  const verdict = await c.get('verifyReporter')(userId);
  if (!verdict.ok) return fail(c, 'unauthorized', verdict.reason, 401);

  const rows = await db
    .select({
      id: schema.tickets.id,
      kind: schema.tickets.kind,
      title: schema.tickets.title,
      status: schema.tickets.status,
      createdAt: schema.tickets.createdAt,
      updatedAt: schema.tickets.updatedAt,
      isPublicRoadmap: schema.tickets.isPublicRoadmap,
      voteCount: voteCountExpr,
    })
    .from(schema.tickets)
    .leftJoin(schema.ticketVotes, eq(schema.ticketVotes.ticketId, schema.tickets.id))
    .where(
      and(
        eq(schema.tickets.projectId, project.id),
        eq(schema.tickets.reporterId, userId),
      ),
    )
    .groupBy(schema.tickets.id)
    .orderBy(desc(schema.tickets.createdAt))
    .limit(limit);

  return ok(c, rows);
});
