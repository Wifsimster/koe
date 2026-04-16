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

/**
 * Lifecycle of a project identity secret. `active` accepts signatures;
 * `retiring` still verifies (grace window during rotation) but is never
 * handed out to new integrators; `revoked` is rejected.
 */
export const identitySecretStatusEnum = pgEnum('identity_secret_status', [
  'active',
  'retiring',
  'revoked',
]);

/**
 * Dashboard roles. Only `owner` is populated today — `member` and `viewer`
 * exist so we don't rewrite every admin query the day a customer asks for
 * a second seat. Wiring happens in the admin surface MR.
 */
export const projectMemberRoleEnum = pgEnum('project_member_role', [
  'owner',
  'member',
  'viewer',
]);

export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  accentColor: text('accent_color').notNull().default('#4f46e5'),
  allowedOrigins: jsonb('allowed_origins').$type<string[]>().notNull().default([]),
  /**
   * Legacy per-project HMAC secret used to verify `X-Koe-User-Hash`
   * (reporter-id-only hash). Kept for backward compatibility with
   * integrations that signed under the v1 scheme. New integrations should
   * use signed identity tokens (see `projectIdentitySecrets`) which bind
   * the signature to `iat`, `nonce`, and `kid` — enabling TTL and
   * non-breaking rotation.
   *
   * @deprecated Prefer signed identity tokens via `projectIdentitySecrets`.
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

/**
 * Versioned HMAC secrets per project. Multiple `active` rows are allowed
 * during a rotation window — the verifier tries each active secret keyed
 * by the `kid` the token carries. Host apps include the `kid` they used
 * to sign, so flipping the default is a non-breaking operation.
 *
 * Composite PK (projectId, kid) keeps lookups index-only and prevents
 * accidental duplicate kids within a project.
 */
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

/**
 * Dashboard membership. Composite PK (projectId, userId) ensures a single
 * role per user per project. The `role` column is the authorization
 * decision — admin routes must check it, never the session alone.
 */
export const projectMembers = pgTable(
  'project_members',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    role: projectMemberRoleEnum('role').notNull().default('owner'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.projectId, t.userId] }),
  }),
);

export const projectsRelations = relations(projects, ({ many }) => ({
  tickets: many(tickets),
  conversations: many(conversations),
  identitySecrets: many(projectIdentitySecrets),
  members: many(projectMembers),
}));

export const projectIdentitySecretsRelations = relations(projectIdentitySecrets, ({ one }) => ({
  project: one(projects, {
    fields: [projectIdentitySecrets.projectId],
    references: [projects.id],
  }),
}));

export const projectMembersRelations = relations(projectMembers, ({ one }) => ({
  project: one(projects, {
    fields: [projectMembers.projectId],
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
