import { hash, verify } from '@node-rs/argon2';

const HASH_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, HASH_OPTIONS);
}

export function verifyPassword(encoded: string, plaintext: string): Promise<boolean> {
  return verify(encoded, plaintext);
}
