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
import { notifyNewTicket } from '../lib/notifications';
import { sanitizeMetadata } from '../lib/reportContext';

const MAX_BODY_BYTES = 256 * 1024;

type WidgetVariables = ProjectContext & { verifyReporter: VerifyReporterFn };

export const widgetRoutes = new Hono<{ Variables: WidgetVariables }>();

widgetRoutes.use('*', widgetCors);
widgetRoutes.use('*', bodyLimit({ maxSize: MAX_BODY_BYTES }));

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
        metadata: sanitizeMetadata(input.metadata, input.reporter),
        screenshotUrl: input.screenshotUrl,
      })
      .returning(),
  );

  void notifyNewTicket(row, project);

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
        metadata: sanitizeMetadata(input.metadata, input.reporter),
      })
      .returning(),
  );

  void notifyNewTicket(row, project);

  return ok(c, { ...row, voteCount: 0, hasVoted: false }, 201);
});

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
    .where(and(eq(schema.tickets.projectId, project.id), eq(schema.tickets.reporterId, userId)))
    .groupBy(schema.tickets.id)
    .orderBy(desc(schema.tickets.createdAt))
    .limit(limit);

  return ok(c, rows);
});
