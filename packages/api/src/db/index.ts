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

export const db = client ? drizzle(client, { schema }) : (null as unknown as ReturnType<typeof drizzle>);
export const dbAvailable = client !== null;
export { schema };
