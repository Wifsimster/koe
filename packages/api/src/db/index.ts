import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  // We don't throw at module-load time because some entry points (e.g.
  // typecheck, unit tests) import this file without a running DB. Callers
  // that actually need the db should check `dbAvailable` first.
  console.warn('[koe/api] DATABASE_URL is not set — db client will be lazy.');
}

const client = connectionString ? postgres(connectionString) : null;

export const db = client
  ? drizzle(client, { schema })
  : (null as unknown as ReturnType<typeof drizzle>);
export const dbAvailable = client !== null;
export { schema };

/**
 * Returns the first row of a query result, throwing if the array is
 * empty. Use after `INSERT ... RETURNING` or a SELECT that must produce
 * at least one row — lets us keep `noUncheckedIndexedAccess` on while
 * avoiding a sea of `rows[0]!` assertions.
 */
export function firstOrThrow<T>(rows: T[], label = 'row'): T {
  const row = rows[0];
  if (!row) throw new Error(`Expected at least one ${label}, got none`);
  return row;
}
