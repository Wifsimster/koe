import { sql } from 'drizzle-orm';
import { schema } from './index';

export const voteCountExpr = sql<number>`count(${schema.ticketVotes.ticketId})::int`;
