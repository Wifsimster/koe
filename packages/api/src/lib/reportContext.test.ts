import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { redactText, redactUrl } from '@koe/shared';
import { createBugSchema } from './schemas';
import { sanitizeMetadata } from './reportContext';

const JWT =
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTQyIiwiaWF0IjoxNzAwMDAwMDAwfQ.c2lnbmF0dXJlLXZhbHVlLTEyMzQ';

describe('redactUrl', () => {
  it('drops every query value and keeps the names', () => {
    assert.equal(
      redactUrl('https://app.example/projects?tab=export&token=abc'),
      'https://app.example/projects?tab=&token=',
    );
  });

  it('keeps allowlisted values, never for sensitive names or token-like values', () => {
    const keep = { keepQueryParams: ['tab', 'token', 'q'] };
    assert.equal(
      redactUrl(
        'https://a.example/p?tab=export&token=abc&q=Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZg',
        keep,
      ),
      'https://a.example/p?tab=export&token=&q=',
    );
  });

  it('redacts hash parameters but keeps a plain anchor', () => {
    assert.equal(
      redactUrl('https://a.example/cb#access_token=xyz&state=1'),
      'https://a.example/cb#access_token=&state=',
    );
    assert.equal(redactUrl('https://a.example/doc#top'), 'https://a.example/doc#top');
  });

  it('redacts token-like path segments and credentials, keeps UUIDs', () => {
    assert.equal(
      redactUrl('https://user:pw@a.example/reset/Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4z0/x'),
      'https://a.example/reset/[redacted]/x',
    );
    const uuid = '612407e0-60c0-4c1f-b460-6eb28b9dcc23';
    assert.equal(
      redactUrl(`https://a.example/tickets/${uuid}`),
      `https://a.example/tickets/${uuid}`,
    );
  });

  it('keeps relative URLs relative', () => {
    assert.equal(redactUrl('/api/rows?page=2'), '/api/rows?page=');
  });
});

describe('redactText', () => {
  it('redacts JWTs, bearer tokens, key=value secrets, e-mails and URLs', () => {
    const out = redactText(
      `fetch https://api.example/rows?sig=abc failed for jane@acme.test with Bearer abc.def token=s3cr3t ${JWT}`,
    );
    assert.equal(
      out,
      'fetch https://api.example/rows?sig= failed for [email] with Bearer [redacted] token=[redacted] [redacted]',
    );
  });

  it('keeps ordinary error text', () => {
    const msg = '[acme] Export CSV failed: TypeError: rows.map is not a function';
    assert.equal(redactText(msg), msg);
  });

  it('truncates long messages', () => {
    assert.equal(redactText('x '.repeat(600), 20).length, 20);
  });
});

const base = {
  title: 't',
  description: 'd',
  reporter: { id: 'user-42' },
  metadata: {
    userAgent: 'UA',
    url: 'https://app.example/projects?tab=export&token=abc',
    viewport: { width: 1, height: 1 },
    screen: { width: 1, height: 1 },
    language: 'en',
    timezone: 'UTC',
    devicePixelRatio: 1,
    capturedAt: '2026-10-04T00:00:00Z',
  },
};

describe('createBugSchema capture bounds', () => {
  it('accepts the enriched context', () => {
    const r = createBugSchema.safeParse({
      ...base,
      metadata: {
        ...base.metadata,
        redaction: 'query-values',
        widgetVersion: 'v1.9.0',
        app: { version: '2.3.1' },
        input: { maxTouchPoints: 5, coarsePointer: true, hover: false },
        breadcrumbs: [
          { ts: 'x', type: 'click', target: { tag: 'button', role: 'button', name: 'Export CSV' } },
          { ts: 'x', type: 'navigation', url: '/projects' },
        ],
        console: [{ ts: 'x', level: 'error', message: 'boom' }],
        network: [{ ts: 'x', method: 'GET', url: '/api', status: 500, durationMs: 12 }],
      },
    });
    assert.equal(r.success, true, JSON.stringify(r.error?.issues));
  });

  it('rejects a buffer above the bound', () => {
    const console = Array.from({ length: 51 }, () => ({ ts: 'x', level: 'error', message: 'm' }));
    assert.equal(
      createBugSchema.safeParse({ ...base, metadata: { ...base.metadata, console } }).success,
      false,
    );
  });

  it('rejects an input breadcrumb that tries to carry a value', () => {
    const r = createBugSchema.safeParse({
      ...base,
      metadata: {
        ...base.metadata,
        breadcrumbs: [{ ts: 'x', type: 'input', target: { tag: 'input' }, value: 'hunter2' }],
      },
    });
    assert.equal(r.success, true);
    if (r.success) assert.equal(JSON.stringify(r.data).includes('hunter2'), false);
  });
});

describe('sanitizeMetadata', () => {
  it('redacts every query value from a widget that did not redact', () => {
    const r = createBugSchema.parse(base);
    const m = sanitizeMetadata(r.metadata, r.reporter);
    assert.equal(m.url, 'https://app.example/projects?tab=&token=');
    assert.equal(m.redaction, 'query-values');
  });

  it('keeps values a redacting widget kept, minus sensitive ones', () => {
    const r = createBugSchema.parse({
      ...base,
      metadata: {
        ...base.metadata,
        redaction: 'query-values',
        url: 'https://app.example/p?tab=export&token=abc',
      },
    });
    assert.equal(
      sanitizeMetadata(r.metadata, r.reporter).url,
      'https://app.example/p?tab=export&token=',
    );
  });

  it('redacts console text, network URLs and breadcrumb names again', () => {
    const r = createBugSchema.parse({
      ...base,
      metadata: {
        ...base.metadata,
        redaction: 'query-values',
        console: [{ ts: 'x', level: 'error', message: `auth failed ${JWT}` }],
        network: [
          { ts: 'x', method: 'GET', url: '/api/rows?apikey=k', status: 401, durationMs: 3 },
        ],
        breadcrumbs: [
          { ts: 'x', type: 'click', target: { tag: 'a', name: 'Mail jane@acme.test' } },
        ],
      },
    });
    const m = sanitizeMetadata(r.metadata, r.reporter) as Record<string, any>;
    assert.equal(m.console[0].message, 'auth failed [redacted]');
    assert.equal(m.network[0].url, '/api/rows?apikey=');
    assert.equal(m.breadcrumbs[0].target.name, 'Mail [email]');
  });

  it('keeps reporter.metadata instead of dropping it', () => {
    const r = createBugSchema.parse({
      ...base,
      reporter: { id: 'user-42', metadata: { plan: 'pro', seats: 3 } },
    });
    assert.deepEqual(sanitizeMetadata(r.metadata, r.reporter).reporterMetadata, {
      plan: 'pro',
      seats: 3,
    });
  });
});
