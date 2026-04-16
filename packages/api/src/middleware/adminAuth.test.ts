import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRawSessionToken,
  hashSessionToken,
  digestEquals,
} from './adminAuth';

describe('adminAuth token helpers', () => {
  it('createRawSessionToken produces 32 bytes of base64url entropy', () => {
    const a = createRawSessionToken();
    // 32 bytes in base64url: ceil(32 / 3) * 4 = 44 chars, no padding.
    assert.equal(a.length, 43);
    assert.match(a, /^[A-Za-z0-9_-]+$/);
  });

  it('createRawSessionToken returns distinct values', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(createRawSessionToken());
    assert.equal(seen.size, 100);
  });

  it('hashSessionToken is deterministic', () => {
    const raw = createRawSessionToken();
    assert.equal(hashSessionToken(raw), hashSessionToken(raw));
  });

  it('hashSessionToken is one-way enough: different inputs → different hashes', () => {
    const a = hashSessionToken('token-a');
    const b = hashSessionToken('token-b');
    assert.notEqual(a, b);
    // SHA-256 hex is 64 chars.
    assert.equal(a.length, 64);
    assert.equal(b.length, 64);
  });

  it('digestEquals returns true for identical hex strings', () => {
    const h = hashSessionToken('same');
    assert.equal(digestEquals(h, h), true);
  });

  it('digestEquals returns false for differing hex strings of the same length', () => {
    const a = hashSessionToken('a');
    const b = hashSessionToken('b');
    assert.equal(a.length, b.length);
    assert.equal(digestEquals(a, b), false);
  });

  it('digestEquals returns false for different lengths', () => {
    assert.equal(digestEquals('abc', 'abcd'), false);
  });
});
