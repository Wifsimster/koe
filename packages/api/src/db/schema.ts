import {
  pgTable,
  text,
  timestamp,
  boolean,
  jsonb,
  uuid,
  pgEnum,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

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

export const identitySecretStatusEnum = pgEnum('identity_secret_status', [
  'active',
  'retiring',
  'revoked',
]);

export const ticketEventKindEnum = pgEnum('ticket_event_kind', [
  'status_changed',
  'priority_changed',
  'roadmap_toggled',
]);

export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  accentColor: text('accent_color').notNull().default('#4f46e5'),
  allowedOrigins: jsonb('allowed_origins').$type<string[]>().notNull().default([]),
  identitySecret: text('identity_secret').notNull(),
  requireIdentityVerification: boolean('require_identity_verification')
    .notNull()
    .default(false),
  lastPingAt: timestamp('last_ping_at', { withTimezone: true }),
  lastPingOrigin: text('last_ping_origin'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const tickets = pgTable(
  'tickets',
  {
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
    reporterVerified: boolean('reporter_verified').notNull().default(false),
    stepsToReproduce: text('steps_to_reproduce'),
    expectedBehavior: text('expected_behavior'),
    actualBehavior: text('actual_behavior'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    screenshotUrl: text('screenshot_url'),
    notes: text('notes'),
    isPublicRoadmap: boolean('is_public_roadmap').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    publicRoadmapIdx: index('tickets_project_public_roadmap_idx')
      .on(t.projectId, t.status)
      .where(sql`${t.isPublicRoadmap} = true`),
  }),
);

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
  authorKind: text('author_kind').notNull(),
  authorId: text('author_id').notNull(),
  authorName: text('author_name'),
  body: text('body').notNull(),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const projectIdentitySecrets = pgTable(
  'project_identity_secrets',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    kid: text('kid').notNull(),
    secret: text('secret').notNull(),
    status: identitySecretStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.projectId, t.kid] }),
  }),
);

export const projectsRelations = relations(projects, ({ many }) => ({
  tickets: many(tickets),
  conversations: many(conversations),
  identitySecrets: many(projectIdentitySecrets),
}));

export const projectIdentitySecretsRelations = relations(projectIdentitySecrets, ({ one }) => ({
  project: one(projects, {
    fields: [projectIdentitySecrets.projectId],
    references: [projects.id],
  }),
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

export const adminTicketEvents = pgTable('admin_ticket_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  ticketId: uuid('ticket_id')
    .notNull()
    .references(() => tickets.id, { onDelete: 'cascade' }),
  kind: ticketEventKindEnum('kind').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const adminTicketEventsRelations = relations(adminTicketEvents, ({ one }) => ({
  ticket: one(tickets, {
    fields: [adminTicketEvents.ticketId],
    references: [tickets.id],
  }),
}));

export const adminSessions = pgTable(
  'admin_sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    expiresAtIdx: index('admin_sessions_expires_at_idx').on(t.expiresAt),
  }),
);
