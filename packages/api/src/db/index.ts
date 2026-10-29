import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.warn('[koe/api] DATABASE_URL is not set — db client will be lazy.');
}

const client = connectionString ? postgres(connectionString) : null;

export const db = client
  ? drizzle(client, { schema })
  : (null as unknown as ReturnType<typeof drizzle>);
export const dbAvailable = client !== null;
export { schema };

export function firstOrThrow<T>(rows: T[], label = 'row'): T {
  const row = rows[0];
  if (!row) throw new Error(`Expected at least one ${label}, got none`);
  return row;
}
