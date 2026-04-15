import {
  pgTable,
  text,
  timestamp,
  boolean,
  jsonb,
  uuid,
  pgEnum,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const ticketKindEnum = pgEnum('ticket_kind', ['bug', 'feature']);
export const ticketStatusEnum = pgEnum('ticket_status', [
  'open',
  'in_progress',
  'planned',
  'resolved',
  'closed',
  'wont_fix',
]);
export const ticketPriorityEnum = pgEnum('ticket_priority', ['low', 'medium', 'high', 'critical']);

export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  accentColor: text('accent_color').notNull().default('#4f46e5'),
  allowedOrigins: jsonb('allowed_origins').$type<string[]>().notNull().default([]),
  /**
   * Per-project HMAC secret used to verify reporter identity hashes
   * supplied by the host app. Never expose this to the browser — it lives
   * on the host app's backend.
   */
  identitySecret: text('identity_secret').notNull(),
  /**
   * When true, submissions MUST include a valid `X-Koe-User-Hash` header
   * matching HMAC-SHA256(identitySecret, reporter.id). When false (the
   * default in dev), the hash is verified if present but not required.
   */
  requireIdentityVerification: boolean('require_identity_verification')
    .notNull()
    .default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const tickets = pgTable('tickets', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  kind: ticketKindEnum('kind').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  status: ticketStatusEnum('status').notNull().default('open'),
  priority: ticketPriorityEnum('priority').notNull().default('medium'),
  reporterId: text('reporter_id').notNull(),
  reporterName: text('reporter_name'),
  reporterEmail: text('reporter_email'),
  /**
   * True when the reporter was validated via HMAC at submission time.
   * Lets the admin UI distinguish verified vs. self-asserted identities.
   */
  reporterVerified: boolean('reporter_verified').notNull().default(false),
  // Bug-only fields.
  stepsToReproduce: text('steps_to_reproduce'),
  expectedBehavior: text('expected_behavior'),
  actualBehavior: text('actual_behavior'),
  // Captured environment.
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  /** URL to screenshot stored on object storage — never base64 inline. */
  screenshotUrl: text('screenshot_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Each row is one user's vote on one feature request. Composite PK on
 * (ticketId, userId) prevents double-voting at the database level, which
 * kills the read-modify-write race that the previous jsonb-array design
 * had. `voteCount` is derived on read via `count(*)`.
 */
export const ticketVotes = pgTable(
  'ticket_votes',
  {
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.ticketId, t.userId] }),
  }),
);

export const conversations = pgTable('conversations', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const messages = pgTable('messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  authorKind: text('author_kind').notNull(), // 'user' | 'admin' | 'system'
  authorId: text('author_id').notNull(),
  authorName: text('author_name'),
  body: text('body').notNull(),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const projectsRelations = relations(projects, ({ many }) => ({
  tickets: many(tickets),
  conversations: many(conversations),
}));

export const ticketsRelations = relations(tickets, ({ one, many }) => ({
  project: one(projects, {
    fields: [tickets.projectId],
    references: [projects.id],
  }),
  votes: many(ticketVotes),
}));

export const ticketVotesRelations = relations(ticketVotes, ({ one }) => ({
  ticket: one(tickets, {
    fields: [ticketVotes.ticketId],
    references: [tickets.id],
  }),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  project: one(projects, {
    fields: [conversations.projectId],
    references: [projects.id],
  }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));
