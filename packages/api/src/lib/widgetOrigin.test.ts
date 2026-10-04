import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { checkRequestOrigin, isOriginAllowed, preflightHeaders } from './widgetOrigin.js';
import { createWidgetCors } from '../middleware/cors.js';

const HOST = 'https://app.customer.example';
const WIDGET_HEADERS = 'content-type,x-koe-project-key,x-koe-user-hash';

describe('preflightHeaders', () => {
  it('answers a browser preflight that carries no project key', () => {
    const h = preflightHeaders(HOST, 'POST', WIDGET_HEADERS);
    assert.ok(h);
    assert.equal(h['Access-Control-Allow-Origin'], HOST);
    assert.equal(h['Access-Control-Allow-Methods'], 'GET, POST');
    assert.match(h['Access-Control-Allow-Headers']!, /x-koe-identity-token/);
    assert.equal(h['Access-Control-Allow-Credentials'], undefined);
  });

  it('accepts header names in any case and with spaces', () => {
    assert.ok(
      preflightHeaders(HOST, 'get', 'Content-Type, X-Koe-Project-Key, X-Koe-Identity-Token'),
    );
  });

  it('accepts a preflight with no requested headers', () => {
    assert.ok(preflightHeaders(HOST, 'GET', undefined));
  });

  it('never answers with a wildcard origin', () => {
    const h = preflightHeaders(HOST, 'POST', WIDGET_HEADERS);
    assert.notEqual(h?.['Access-Control-Allow-Origin'], '*');
  });

  it('refuses a missing or opaque origin', () => {
    assert.equal(preflightHeaders(undefined, 'POST', WIDGET_HEADERS), null);
    assert.equal(preflightHeaders('null', 'POST', WIDGET_HEADERS), null);
  });

  it('refuses methods the widget API does not serve', () => {
    assert.equal(preflightHeaders(HOST, 'DELETE', WIDGET_HEADERS), null);
    assert.equal(preflightHeaders(HOST, 'PATCH', WIDGET_HEADERS), null);
    assert.equal(preflightHeaders(HOST, undefined, WIDGET_HEADERS), null);
  });

  it('refuses headers outside the widget set', () => {
    assert.equal(preflightHeaders(HOST, 'POST', `${WIDGET_HEADERS},authorization`), null);
    assert.equal(preflightHeaders(HOST, 'POST', 'cookie'), null);
  });
});

describe('isOriginAllowed', () => {
  it('treats an empty list as any origin', () => {
    assert.equal(isOriginAllowed([], HOST), true);
  });
  it('matches exact origins only', () => {
    assert.equal(isOriginAllowed([HOST], HOST), true);
    assert.equal(isOriginAllowed([HOST], 'https://evil.example'), false);
    assert.equal(isOriginAllowed([HOST], `${HOST}.evil.example`), false);
  });
});

describe('checkRequestOrigin', () => {
  it('accepts anything when the project has no allowlist', () => {
    assert.deepEqual(
      checkRequestOrigin({ allowedOrigins: [], origin: undefined, secFetchSite: undefined }),
      { ok: true },
    );
  });

  it('accepts an allowed origin', () => {
    assert.deepEqual(
      checkRequestOrigin({ allowedOrigins: [HOST], origin: HOST, secFetchSite: 'cross-site' }),
      { ok: true },
    );
  });

  it('refuses a disallowed origin', () => {
    const r = checkRequestOrigin({
      allowedOrigins: [HOST],
      origin: 'https://evil.example',
      secFetchSite: 'cross-site',
    });
    assert.deepEqual(r, { ok: false, message: 'Origin https://evil.example is not allowed' });
  });

  it('accepts a same-origin GET, which browsers send without Origin', () => {
    assert.deepEqual(
      checkRequestOrigin({
        allowedOrigins: [HOST],
        origin: undefined,
        secFetchSite: 'same-origin',
      }),
      { ok: true },
    );
  });

  it('refuses a request with neither Origin nor a same-origin fetch site', () => {
    for (const secFetchSite of [undefined, 'cross-site', 'same-site', 'none']) {
      const r = checkRequestOrigin({ allowedOrigins: [HOST], origin: undefined, secFetchSite });
      assert.deepEqual(r, { ok: false, message: 'Origin header is required' });
    }
  });
});

describe('widgetCors', () => {
  const ALLOWLISTED = 'https://allowed.example';
  const projects: Record<string, string[]> = { strict: [ALLOWLISTED] };
  const app = new Hono();
  app.use(
    '*',
    createWidgetCors({
      projectOrigins: async (key) => projects[key] ?? null,
      anyProjectAccepts: async (origin) => Object.values(projects).some((o) => o.includes(origin)),
    }),
  );
  app.post('/v1/widget/bugs', (c) => c.text('handler ran'));

  const preflight = (origin: string, headers = WIDGET_HEADERS) =>
    app.request('/v1/widget/bugs', {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': headers,
      },
    });

  it('answers a browser preflight (no project key) for an allowlisted origin', async () => {
    const res = await preflight(ALLOWLISTED);
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), ALLOWLISTED);
    assert.equal(res.headers.get('access-control-allow-credentials'), null);
    assert.match(res.headers.get('vary') ?? '', /Origin/);
  });

  it('gives no CORS headers to an origin no project accepts', async () => {
    const res = await preflight('https://evil.example');
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });

  it('gives no CORS headers to a foreign requested header', async () => {
    const res = await preflight(ALLOWLISTED, 'authorization');
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });

  it('reflects the origin on a real request only for the project that allows it', async () => {
    const ok = await app.request('/v1/widget/bugs', {
      method: 'POST',
      headers: { Origin: ALLOWLISTED, 'X-Koe-Project-Key': 'strict' },
    });
    assert.equal(ok.headers.get('access-control-allow-origin'), ALLOWLISTED);
    const other = await app.request('/v1/widget/bugs', {
      method: 'POST',
      headers: { Origin: 'https://evil.example', 'X-Koe-Project-Key': 'strict' },
    });
    assert.equal(other.headers.get('access-control-allow-origin'), null);
    const unknown = await app.request('/v1/widget/bugs', {
      method: 'POST',
      headers: { Origin: ALLOWLISTED, 'X-Koe-Project-Key': 'nope' },
    });
    assert.equal(unknown.headers.get('access-control-allow-origin'), null);
  });
});
