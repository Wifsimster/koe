import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, firstOrThrow, schema } from '../db';
import { ok, fail } from '../lib/response';
import { requireProject, type ProjectContext } from '../middleware/project';
import { attachVerifier, type VerifyReporterFn } from '../middleware/identity';
import { widgetCors } from '../middleware/cors';
import { clientIp, rateLimit } from '../middleware/rateLimit';

/** 256 KB hard cap on any widget payload. Screenshots go through a
 *  presigned upload flow, never inline base64 (see `screenshotUrl`). */
const MAX_BODY_BYTES = 256 * 1024;

const reporterSchema = z.object({
  id: z.string().min(1).max(256),
  name: z.string().max(200).optional(),
  email: z.string().email().max(320).optional(),
  avatarUrl: z
    .string()
    .url()
    .max(2048)
    // Block `javascript:` and `data:` scheme injection into the admin UI.
    .refine((u) => /^https?:\/\//i.test(u), 'avatarUrl must be http(s)')
    .optional(),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});

const metadataSchema = z.object({
  userAgent: z.string().max(1024),
  url: z.string().max(2048),
  referrer: z.string().max(2048).optional(),
  viewport: z.object({ width: z.number(), height: z.number() }),
  screen: z.object({ width: z.number(), height: z.number() }),
  language: z.string().max(32),
  timezone: z.string().max(64),
  devicePixelRatio: z.number(),
  capturedAt: z.string().max(64),
});

const createBugSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(10_000),
  stepsToReproduce: z.string().max(10_000).optional(),
  expectedBehavior: z.string().max(10_000).optional(),
  actualBehavior: z.string().max(10_000).optional(),
  reporter: reporterSchema,
  metadata: metadataSchema,
  /**
   * Reference to a screenshot uploaded via presigned URL. The actual
   * upload never flows through this endpoint — that's what blew up
   * Postgres row sizes in the jsonb-blob design.
   */
  screenshotUrl: z.string().url().max(2048).optional(),
});

const createFeatureSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(10_000),
  reporter: reporterSchema,
  metadata: metadataSchema,
});

const voteSchema = z.object({
  userId: z.string().min(1).max(256),
});

type WidgetVariables = ProjectContext & { verifyReporter: VerifyReporterFn };

export const widgetRoutes = new Hono<{ Variables: WidgetVariables }>();

widgetRoutes.use('*', widgetCors);
widgetRoutes.use('*', bodyLimit({ maxSize: MAX_BODY_BYTES }));

// Rate limit before DB work — cheap rejection for floods. 10 req/s with
// a 30-request burst, keyed on (project key, client IP). The project key
// is used before `requireProject` runs, so unknown keys still get
// rate-limited by header value (preventing brute-force enumeration).
widgetRoutes.use(
  '*',
  rateLimit({
    refillPerSecond: 10 / 60, // 10/min
    capacity: 30,
    key: (c) => {
      const key = c.req.header('X-Koe-Project-Key') ?? 'unknown';
      const ip = clientIp(c.req.raw);
      return `${key}:${ip}`;
    },
  }),
);

widgetRoutes.use('*', requireProject);
widgetRoutes.use('*', attachVerifier);

widgetRoutes.post('/bugs', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createBugSchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, 'validation_failed', 'Invalid bug report payload', 422, {
      issues: parsed.error.issues,
    });
  }
  const input = parsed.data;
  const project = c.get('project');

  const verdict = c.get('verifyReporter')(input.reporter.id);
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
  const body = await c.req.json().catch(() => null);
  const parsed = createFeatureSchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, 'validation_failed', 'Invalid feature request payload', 422, {
      issues: parsed.error.issues,
    });
  }
  const input = parsed.data;
  const project = c.get('project');

  const verdict = c.get('verifyReporter')(input.reporter.id);
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

  const voteCountExpr = sql<number>`count(${schema.ticketVotes.ticketId})::int`;
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
  const body = await c.req.json().catch(() => null);
  const parsed = voteSchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, 'validation_failed', 'userId is required', 422);
  }
  const { userId } = parsed.data;

  const verdict = c.get('verifyReporter')(userId);
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
