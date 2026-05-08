import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { allowedOriginSchema, createProjectSchema } from './schemas';

/**
 * Each invalid case is its own assertion so a regression failure
 * names the exact rule that regressed, not "one of these eight
 * inputs". The accepted set covers the canonical shapes the
 * dashboard form will produce.
 */
describe('allowedOriginSchema', () => {
  describe('accepts canonical origin shapes', () => {
    const cases = [
      'https://example.com',
      'http://localhost:3000',
      'https://app.example.com:8443',
      'https://sub.domain.example.co.uk',
      'http://127.0.0.1:8080',
    ];
    for (const input of cases) {
      it(input, () => {
        const r = allowedOriginSchema.safeParse(input);
        assert.equal(r.success, true, JSON.stringify(r));
      });
    }
  });

  describe('rejects malformed entries', () => {
    const cases: [string, string][] = [
      ['*', 'wildcard'],
      ['file:///etc/passwd', 'file:// scheme'],
      ['https://example.com/', 'trailing slash'],
      ['https://example.com/admin', 'path component'],
      ['https://example.com?x=1', 'query component'],
      ['https://example.com#frag', 'fragment'],
      ['ftp://example.com', 'non-http scheme'],
      ['https://user:pw@example.com', 'credentials'],
      ['javascript:alert(1)', 'js scheme'],
      ['data:text/html,xss', 'data scheme'],
      ['not a url', 'plain string'],
      ['', 'empty'],
    ];
    for (const [input, label] of cases) {
      it(`${label}: ${JSON.stringify(input)}`, () => {
        const r = allowedOriginSchema.safeParse(input);
        assert.equal(r.success, false);
      });
    }
  });
});

describe('createProjectSchema.allowedOrigins', () => {
  it('accepts an empty array (permissive)', () => {
    const r = createProjectSchema.safeParse({
      name: 'Acme',
      key: 'acme',
      allowedOrigins: [],
    });
    assert.equal(r.success, true);
  });

  it('accepts a list of valid origins', () => {
    const r = createProjectSchema.safeParse({
      name: 'Acme',
      key: 'acme',
      allowedOrigins: ['https://acme.example', 'http://localhost:5173'],
    });
    assert.equal(r.success, true);
  });

  it('rejects when any single entry is malformed', () => {
    const r = createProjectSchema.safeParse({
      name: 'Acme',
      key: 'acme',
      allowedOrigins: ['https://acme.example', 'https://acme.example/path'],
    });
    assert.equal(r.success, false);
  });

  it('caps the list length at 20', () => {
    const origins = Array.from({ length: 21 }, (_, i) => `https://h${i}.example`);
    const r = createProjectSchema.safeParse({
      name: 'Acme',
      key: 'acme',
      allowedOrigins: origins,
    });
    assert.equal(r.success, false);
  });
});
