import { sql } from 'drizzle-orm';
import { schema } from './index';

/**
 * Aggregate vote count expression for a `tickets LEFT JOIN ticket_votes`
 * query. Always pair with a `GROUP BY tickets.id` — otherwise the count
 * collapses across rows and you get garbage. Cast to int because
 * `count()` returns bigint which Drizzle surfaces as string.
 */
export const voteCountExpr = sql<number>`count(${schema.ticketVotes.ticketId})::int`;
