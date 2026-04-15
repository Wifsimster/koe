import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { ok, fail } from '../lib/response';
import { requireProject, type ProjectContext } from '../middleware/project';

const reporterSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  email: z.string().email().optional(),
  avatarUrl: z.string().url().optional(),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});

const metadataSchema = z.object({
  userAgent: z.string(),
  url: z.string(),
  referrer: z.string().optional(),
  viewport: z.object({ width: z.number(), height: z.number() }),
  screen: z.object({ width: z.number(), height: z.number() }),
  language: z.string(),
  timezone: z.string(),
  devicePixelRatio: z.number(),
  capturedAt: z.string(),
});

const createBugSchema = z.object({
  projectKey: z.string(),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(10_000),
  stepsToReproduce: z.string().max(10_000).optional(),
  expectedBehavior: z.string().max(10_000).optional(),
  actualBehavior: z.string().max(10_000).optional(),
  reporter: reporterSchema,
  metadata: metadataSchema,
  screenshotDataUrl: z.string().optional(),
});

const createFeatureSchema = z.object({
  projectKey: z.string(),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(10_000),
  reporter: reporterSchema,
  metadata: metadataSchema,
});

export const widgetRoutes = new Hono<{ Variables: ProjectContext }>();

widgetRoutes.use('*', requireProject);

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

  const [row] = await db
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
      metadata: input.metadata,
    })
    .returning();

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

  const [row] = await db
    .insert(schema.tickets)
    .values({
      projectId: project.id,
      kind: 'feature',
      title: input.title,
      description: input.description,
      reporterId: input.reporter.id,
      reporterName: input.reporter.name,
      reporterEmail: input.reporter.email,
      metadata: input.metadata,
    })
    .returning();

  return ok(c, row, 201);
});

widgetRoutes.get('/features', async (c) => {
  const project = c.get('project');
  const rows = await db
    .select()
    .from(schema.tickets)
    .where(and(eq(schema.tickets.projectId, project.id), eq(schema.tickets.kind, 'feature')))
    .orderBy(desc(schema.tickets.voteCount), desc(schema.tickets.createdAt))
    .limit(100);
  return ok(c, rows);
});

widgetRoutes.post('/features/:id/vote', async (c) => {
  const project = c.get('project');
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  const userId = typeof body?.userId === 'string' ? body.userId : null;
  if (!userId) {
    return fail(c, 'validation_failed', 'userId is required', 422);
  }

  const [current] = await db
    .select()
    .from(schema.tickets)
    .where(and(eq(schema.tickets.id, id), eq(schema.tickets.projectId, project.id)));

  if (!current || current.kind !== 'feature') {
    return fail(c, 'not_found', 'Feature request not found', 404);
  }

  // Toggle the vote so repeated clicks don't inflate the count.
  const hasVoted = current.voters.includes(userId);
  const nextVoters = hasVoted
    ? current.voters.filter((v) => v !== userId)
    : [...current.voters, userId];

  const [updated] = await db
    .update(schema.tickets)
    .set({
      voters: nextVoters,
      voteCount: nextVoters.length,
      updatedAt: new Date(),
    })
    .where(eq(schema.tickets.id, id))
    .returning();

  return ok(c, updated);
});
