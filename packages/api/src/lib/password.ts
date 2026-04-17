import { hash, verify } from '@node-rs/argon2';

/**
 * Password hashing for `ADMIN_AUTH_MODE=password`.
 *
 * argon2id (the library's default), OWASP "minimum" preset
 * (memory=19 MiB, iterations=2, parallelism=1). These defaults hit
 * ~100ms on modest hardware — fast enough that a login request doesn't
 * feel slow, costly enough that offline brute-force on a DB dump is
 * impractical. The library stores the parameters inside the encoded
 * hash, so we can raise them later without migrating existing rows: a
 * successful verify returns `true` and the next hash-on-change uses
 * the new params.
 *
 * `algorithm` is deliberately not set here — `@node-rs/argon2` ships
 * it as an ambient const enum which clashes with `isolatedModules`,
 * and argon2id is the library default already.
 */
const HASH_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, HASH_OPTIONS);
}

/**
 * Returns true on match, false otherwise. Never throws for a mismatched
 * password — `@node-rs/argon2` returns `false` there. It does throw on
 * malformed hashes, which is the caller's problem (a corrupted DB row);
 * we let that bubble.
 */
export function verifyPassword(encoded: string, plaintext: string): Promise<boolean> {
  return verify(encoded, plaintext);
}
