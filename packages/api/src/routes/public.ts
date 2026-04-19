import { Hono } from 'hono';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db';
import { voteCountExpr } from '../db/queries';
import { fail, ok } from '../lib/response';
import { clientIp, createRateLimiterFromEnv, rateLimit } from '../middleware/rateLimit';
import {
  ROADMAP_COLUMNS,
  renderRoadmap,
  truncateDescription,
  type RoadmapColumn,
} from '../lib/roadmapHtml';
import type { PublicRoadmapRow } from '@koe/shared';

/**
 * Unauthenticated public surface. Two shapes off the same query:
 *
 *   - `GET /r/:projectKey`                       → SSR HTML for humans /
 *                                                  crawlers, shareable link
 *   - `GET /v1/public/:projectKey/roadmap`       → JSON for programmatic
 *                                                  consumption (e.g. a future
 *                                                  widget "Browse roadmap" tab)
 *
 * Both are rate-limited on (projectKey, clientIP) at a looser ceiling
 * than the widget mutation routes — a single social-share unfurl storm
 * must not trip the widget's limiter.
 */

const PUBLIC_STATUSES: Array<'planned' | 'in_progress' | 'resolved'> = [
  'planned',
  'in_progress',
  'resolved',
];

// 60 rpm per (project, ip) is generous for a shareable page without
// inviting scraping floods. Same token-bucket adapter as the widget.
const publicRateLimiter = createRateLimiterFromEnv({
  refillPerSecond: 60 / 60,
  capacity: 120,
  prefix: 'koe:rl:public:',
});

const publicRateLimit = rateLimit({
  refillPerSecond: 60 / 60,
  capacity: 120,
  limiter: publicRateLimiter,
  key: (c) => {
    const key = c.req.param('projectKey') ?? 'unknown';
    const ip = clientIp(c);
    return `${key}:${ip}`;
  },
});

export const publicRoadmapRoutes = new Hono();

publicRoadmapRoutes.get('/r/:projectKey', publicRateLimit, async (c) => {
  const projectKey = c.req.param('projectKey');
  const project = await loadProject(projectKey);
  if (!project) {
    // Return a plain 404 HTML body — no detail that would help an
    // attacker map valid keys.
    return c.html('<!doctype html><title>Not found</title><h1>Not found</h1>', 404);
  }

  const tickets = await loadPublicTickets(project.id);
  c.header('Cache-Control', 'public, max-age=60');
  return c.html(renderRoadmap({ project, tickets }));
});

publicRoadmapRoutes.get('/v1/public/:projectKey/roadmap', publicRateLimit, async (c) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  const projectKey = c.req.param('projectKey');
  const project = await loadProject(projectKey);
  if (!project) {
    return fail(c, 'not_found', 'Unknown project', 404);
  }

  const tickets = await loadPublicTickets(project.id);
  return ok(c, {
    project: { key: project.key, name: project.name, accentColor: project.accentColor },
    columns: ROADMAP_COLUMNS,
    tickets,
  });
});

// Preflight for the JSON endpoint. HTML route doesn't need CORS.
publicRoadmapRoutes.options('/v1/public/:projectKey/roadmap', (c) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type');
  return c.body(null, 204);
});

async function loadProject(key: string) {
  const [row] = await db
    .select({
      id: schema.projects.id,
      key: schema.projects.key,
      name: schema.projects.name,
      accentColor: schema.projects.accentColor,
    })
    .from(schema.projects)
    .where(eq(schema.projects.key, key))
    .limit(1);
  return row ?? null;
}

/**
 * Column projection is explicit, not `select *`. Never expose reporter
 * email/name, screenshot URL, private metadata, or admin notes on the
 * public roadmap — those live entirely inside the admin API.
 */
async function loadPublicTickets(projectId: string): Promise<PublicRoadmapRow[]> {
  const rows = await db
    .select({
      id: schema.tickets.id,
      kind: schema.tickets.kind,
      title: schema.tickets.title,
      description: schema.tickets.description,
      status: schema.tickets.status,
      voteCount: voteCountExpr,
    })
    .from(schema.tickets)
    .leftJoin(schema.ticketVotes, eq(schema.ticketVotes.ticketId, schema.tickets.id))
    .where(
      and(
        eq(schema.tickets.projectId, projectId),
        eq(schema.tickets.isPublicRoadmap, true),
        inArray(schema.tickets.status, PUBLIC_STATUSES),
      ),
    )
    .groupBy(schema.tickets.id)
    .orderBy(desc(voteCountExpr), desc(schema.tickets.createdAt))
    .limit(200);

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    description: truncateDescription(r.description),
    status: r.status as RoadmapColumn,
    voteCount: r.voteCount,
  }));
}
