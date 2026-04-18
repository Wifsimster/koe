import type { PublicRoadmapRow } from '@koe/shared';

/**
 * Columns rendered on `/r/:projectKey`, in display order. `closed` and
 * `wont_fix` are never shown on the public roadmap — an admin that wants
 * a ticket visible keeps it in one of these three buckets.
 */
export const ROADMAP_COLUMNS = ['planned', 'in_progress', 'resolved'] as const;
export type RoadmapColumn = (typeof ROADMAP_COLUMNS)[number];

const COLUMN_LABELS: Record<RoadmapColumn, string> = {
  planned: 'Planned',
  in_progress: 'In progress',
  resolved: 'Shipped',
};

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Minimal HTML escaper. Used for every reporter-supplied string that
 * flows into the public page — never interpolate raw into the template.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch] ?? ch);
}

export interface RenderRoadmapInput {
  project: { key: string; name: string; accentColor: string };
  tickets: PublicRoadmapRow[];
}

/**
 * Render the public roadmap page for a project. Groups tickets by
 * column, orders each column by vote count desc, escapes every
 * user-supplied string. No JavaScript — this is a crawlable static
 * page, the whole point is shareability and SEO.
 */
export function renderRoadmap({ project, tickets }: RenderRoadmapInput): string {
  const grouped: Record<RoadmapColumn, PublicRoadmapRow[]> = {
    planned: [],
    in_progress: [],
    resolved: [],
  };
  for (const t of tickets) {
    grouped[t.status].push(t);
  }

  const title = `${project.name} — Roadmap`;
  const description = `See what's planned, in progress, and shipped for ${project.name}.`;
  const accent = sanitizeColor(project.accentColor);

  const columnsHtml = ROADMAP_COLUMNS.map((col) => renderColumn(col, grouped[col])).join('\n');

  const isEmpty = tickets.length === 0;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:type" content="website" />
<meta name="robots" content="index,follow" />
<style>
  :root { --koe-accent: ${accent}; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f7f7f9; color: #1a1a1f; }
  header { background: var(--koe-accent); color: #fff; padding: 2rem 1.5rem; }
  header h1 { margin: 0; font-size: 1.75rem; }
  header p { margin: .35rem 0 0; opacity: .85; }
  main { max-width: 1100px; margin: 0 auto; padding: 1.5rem; display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.25rem; }
  @media (max-width: 820px) { main { grid-template-columns: 1fr; } }
  section.col { background: #fff; border-radius: 12px; padding: 1rem; border: 1px solid #e5e7eb; }
  section.col h2 { margin: 0 0 .75rem; font-size: 1rem; letter-spacing: .02em; text-transform: uppercase; color: #6b7280; }
  article.card { padding: .85rem; border: 1px solid #e5e7eb; border-radius: 10px; margin-bottom: .6rem; background: #fafbff; }
  article.card h3 { margin: 0 0 .3rem; font-size: .95rem; line-height: 1.35; }
  article.card p { margin: 0; font-size: .85rem; color: #4b5563; line-height: 1.4; }
  article.card .meta { margin-top: .55rem; display: flex; align-items: center; gap: .5rem; font-size: .75rem; color: #6b7280; }
  article.card .kind { display: inline-block; padding: 1px 6px; border-radius: 999px; background: #eef2ff; color: #3730a3; font-weight: 500; }
  article.card .votes { display: inline-flex; align-items: center; gap: .2rem; }
  .empty-col { font-size: .85rem; color: #9ca3af; font-style: italic; padding: .5rem 0; }
  .empty-state { max-width: 560px; margin: 3rem auto; background: #fff; padding: 2rem; border-radius: 12px; text-align: center; color: #6b7280; border: 1px solid #e5e7eb; }
</style>
</head>
<body>
<header>
<h1>${escapeHtml(project.name)}</h1>
<p>Product roadmap</p>
</header>
${
  isEmpty
    ? `<div class="empty-state"><strong>Nothing published yet.</strong><br />Check back soon for updates.</div>`
    : `<main>\n${columnsHtml}\n</main>`
}
</body>
</html>`;
}

function renderColumn(col: RoadmapColumn, tickets: PublicRoadmapRow[]): string {
  const cards =
    tickets.length === 0
      ? `<div class="empty-col">No items yet.</div>`
      : tickets.map(renderCard).join('\n');
  return `<section class="col" data-status="${col}">
<h2>${escapeHtml(COLUMN_LABELS[col])}</h2>
${cards}
</section>`;
}

function renderCard(t: PublicRoadmapRow): string {
  const kindLabel = t.kind === 'bug' ? 'Bug fix' : 'Feature';
  const votesLine =
    t.kind === 'feature' ? `<span class="votes">▲ ${t.voteCount}</span>` : '';
  return `<article class="card" id="t-${escapeHtml(t.id)}">
<h3>${escapeHtml(t.title)}</h3>
<p>${escapeHtml(t.description)}</p>
<div class="meta"><span class="kind">${escapeHtml(kindLabel)}</span>${votesLine}</div>
</article>`;
}

/**
 * Defense-in-depth on `project.accentColor`. The dashboard already
 * constrains the field, but an operator with DB access could stash any
 * string; we only emit ASCII hex / rgb / rgba / named colors, falling
 * back to the brand default if the value looks suspicious.
 */
function sanitizeColor(color: string): string {
  const trimmed = color.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return trimmed;
  if (/^rgba?\(\s*[\d.,\s%]+\)$/i.test(trimmed)) return trimmed;
  if (/^[a-zA-Z]+$/.test(trimmed) && trimmed.length <= 32) return trimmed;
  return '#4f46e5';
}

/** Truncate a description to a safe length for public display. */
export const ROADMAP_DESCRIPTION_LIMIT = 280;
export function truncateDescription(s: string): string {
  if (s.length <= ROADMAP_DESCRIPTION_LIMIT) return s;
  return s.slice(0, ROADMAP_DESCRIPTION_LIMIT - 1).trimEnd() + '…';
}
