import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeHtml,
  renderRoadmap,
  truncateDescription,
  ROADMAP_DESCRIPTION_LIMIT,
} from './roadmapHtml.js';
import type { PublicRoadmapRow } from '@koe/shared';

const project = { key: 'acme', name: 'Acme', accentColor: '#0ea5e9' };

function row(overrides: Partial<PublicRoadmapRow>): PublicRoadmapRow {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    kind: 'feature',
    title: 'Title',
    description: 'Description',
    status: 'planned',
    voteCount: 0,
    ...overrides,
  };
}

describe('escapeHtml', () => {
  it('escapes the five dangerous characters', () => {
    assert.equal(escapeHtml('<b>"&\'</b>'), '&lt;b&gt;&quot;&amp;&#39;&lt;/b&gt;');
  });

  it('leaves plain ascii alone', () => {
    assert.equal(escapeHtml('hello world 42'), 'hello world 42');
  });
});

describe('truncateDescription', () => {
  it('returns the string unchanged when under the limit', () => {
    const short = 'x'.repeat(ROADMAP_DESCRIPTION_LIMIT);
    assert.equal(truncateDescription(short), short);
  });

  it('truncates and adds an ellipsis when over the limit', () => {
    const long = 'x'.repeat(ROADMAP_DESCRIPTION_LIMIT + 50);
    const out = truncateDescription(long);
    assert.ok(out.length <= ROADMAP_DESCRIPTION_LIMIT);
    assert.ok(out.endsWith('…'));
  });
});

describe('renderRoadmap', () => {
  it('renders an empty-state body when no tickets are provided', () => {
    const html = renderRoadmap({ project, tickets: [] });
    assert.match(html, /<!doctype html>/);
    assert.match(html, /Nothing published yet/);
  });

  it('groups tickets under the correct column headings', () => {
    const html = renderRoadmap({
      project,
      tickets: [
        row({ id: 'p1', title: 'Planned one', status: 'planned' }),
        row({ id: 'i1', title: 'In progress one', status: 'in_progress' }),
        row({ id: 's1', title: 'Shipped one', status: 'resolved' }),
      ],
    });
    // All three cards rendered
    assert.match(html, /Planned one/);
    assert.match(html, /In progress one/);
    assert.match(html, /Shipped one/);
    // Column headers rendered
    assert.match(html, /Planned<\/h2>/);
    assert.match(html, /In progress<\/h2>/);
    assert.match(html, /Shipped<\/h2>/);
    // Anchor ids per card so the widget can deep-link
    assert.match(html, /id="t-p1"/);
  });

  it('escapes reporter-controlled title and description', () => {
    const html = renderRoadmap({
      project,
      tickets: [
        row({
          title: '<script>alert(1)</script>',
          description: '"><img src=x onerror=alert(1)>',
        }),
      ],
    });
    // The literal opening tag must never appear unescaped in the output
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.ok(!html.includes('<img src=x'));
    // The escaped form must appear
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  });

  it('escapes the project name so a malicious name cannot break out', () => {
    const html = renderRoadmap({
      project: { ...project, name: '<h1>x</h1>' },
      tickets: [],
    });
    assert.ok(!html.includes('<h1>x</h1>'));
    assert.match(html, /&lt;h1&gt;x&lt;\/h1&gt;/);
  });

  it('includes og:title and description meta tags', () => {
    const html = renderRoadmap({ project, tickets: [] });
    assert.match(html, /<meta property="og:title"/);
    assert.match(html, /<meta property="og:description"/);
    assert.match(html, /<meta name="description"/);
  });

  it('falls back to the brand accent when color looks unsafe', () => {
    const html = renderRoadmap({
      project: { ...project, accentColor: 'url(javascript:alert(1))' },
      tickets: [],
    });
    // The fallback brand color is emitted instead
    assert.match(html, /--koe-accent: #4f46e5/);
    // The malicious payload is not present anywhere in the doc
    assert.ok(!html.includes('javascript:alert'));
  });

  it('accepts hex, rgb, and named-colour accents verbatim', () => {
    for (const color of ['#123', '#1a2b3c', 'rgb(1,2,3)', 'rebeccapurple']) {
      const html = renderRoadmap({ project: { ...project, accentColor: color }, tickets: [] });
      assert.match(html, new RegExp(`--koe-accent: ${color.replace(/[()]/g, '\\$&')}`));
    }
  });

  it('shows the vote badge only for feature rows', () => {
    const html = renderRoadmap({
      project,
      tickets: [
        row({ id: 'f1', kind: 'feature', title: 'Feature row', voteCount: 7 }),
        row({ id: 'b1', kind: 'bug', title: 'Bug row', voteCount: 0 }),
      ],
    });
    assert.match(html, /▲ 7/);
    // The bug card exists but has no vote badge
    const bugCard = html.slice(html.indexOf('id="t-b1"'));
    assert.ok(!bugCard.includes('votes'));
  });
});
