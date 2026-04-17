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

/**
 * Audit event kinds. `status_changed` and `priority_changed` are the
 * two a PATCH actually emits today; `assigned` and `commented` are
 * listed so the schema doesn't need a migration the day those flows
 * ship. Postgres enum additions are their own DDL, so forward-listing
 * costs nothing and saves a round-trip.
 */
export const ticketEventKindEnum = pgEnum('ticket_event_kind', [
  'status_changed',
  'priority_changed',
  'assigned',
  'commented',
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
  /**
   * Widget heartbeat. Stamped by the project-resolution middleware on
   * every widget request so the dashboard can show
   * "Last ping from yoursite.com, 3 min ago" on the empty state —
   * which is what lets an operator tell whether the <script> tag is
   * actually loading on their site.
   *
   * Non-indexed on purpose: we never query `WHERE last_ping_at > …`,
   * only read it on a single-project lookup.
   */
  lastPingAt: timestamp('last_ping_at', { withTimezone: true }),
  lastPingOrigin: text('last_ping_origin'),
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
   * Admin user who currently owns this ticket, or null for
   * unassigned. Nullable with `ON DELETE SET NULL` so an admin user
   * leaving doesn't drop the ticket — just detaches it, and the
   * inbox puts it back into the unassigned queue.
   */
  assignedToUserId: uuid('assigned_to_user_id').references(() => adminUsers.id, {
    onDelete: 'set null',
  }),
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

/**
 * Dashboard identity. Global per-human, not per-project — membership is
 * carried by `projectMembers`. This is Koe's own user table (operators
 * of the product), totally separate from widget `reporterId`.
 */
export const adminUsers = pgTable('admin_users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Session tokens for dashboard users. Stored as SHA-256 of the raw
 * token (see `adminAuth.hashSessionToken`), so a DB dump does not
 * leak active credentials. The raw token lives only in the client's
 * storage; the server never keeps it after the create call returns.
 *
 * `id` is separate from the token hash so we can invalidate a specific
 * session without re-hashing, and list sessions per-user.
 */
export const adminSessions = pgTable('admin_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => adminUsers.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Audit trail for admin-driven ticket mutations. One row per state
 * transition — what changed, who did it, when.
 *
 * Design notes:
 *   - `actor_user_id` is nullable with `ON DELETE SET NULL`. When a
 *     user leaves, we keep the history but lose the attribution. The
 *     alternative (cascade-delete events with the user) would erase
 *     audit data we might still need.
 *   - `payload jsonb` carries the before/after. Schema is per-kind:
 *       status_changed   → { from: string, to: string }
 *       priority_changed → { from: string, to: string }
 *       assigned         → { fromUserId?, toUserId? }  (future)
 *       commented        → { body }                    (future)
 *     We don't pull each shape into the schema today — a single
 *     `jsonb` keeps forward compatibility while the flows settle.
 *   - Indexed implicitly on ticket_id via the FK; that's the one
 *     read pattern today (list events for a ticket). Add an explicit
 *     index when a second pattern shows up.
 */
export const adminTicketEvents = pgTable('admin_ticket_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  ticketId: uuid('ticket_id')
    .notNull()
    .references(() => tickets.id, { onDelete: 'cascade' }),
  actorUserId: uuid('actor_user_id').references(() => adminUsers.id, {
    onDelete: 'set null',
  }),
  kind: ticketEventKindEnum('kind').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  /**
   * Bulk-action correlation. Every event emitted from a single bulk
   * call shares the same `batchId`; events from individual PATCHes
   * stay `null`. Makes "undo that whole bulk action" a one-query
   * revert instead of N independent ones.
   *
   * Unindexed today — the one query pattern is "give me the events
   * for this batchId" which fans out to < 100 rows max. Add an
   * explicit index if batch reverts become hot.
   */
  batchId: uuid('batch_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const adminUsersRelations = relations(adminUsers, ({ many }) => ({
  sessions: many(adminSessions),
  ticketEvents: many(adminTicketEvents),
  ticketComments: many(adminTicketComments),
}));

export const adminSessionsRelations = relations(adminSessions, ({ one }) => ({
  user: one(adminUsers, {
    fields: [adminSessions.userId],
    references: [adminUsers.id],
  }),
}));

export const adminTicketEventsRelations = relations(adminTicketEvents, ({ one }) => ({
  ticket: one(tickets, {
    fields: [adminTicketEvents.ticketId],
    references: [tickets.id],
  }),
  actor: one(adminUsers, {
    fields: [adminTicketEvents.actorUserId],
    references: [adminUsers.id],
  }),
}));

/**
 * Admin-side comments on tickets. Internal triage notes — not shown
 * to the widget reporter, separate table from the widget-facing
 * `messages` surface by design. This is the surface used by
 * teammates coordinating on a ticket ("already spoke to the user",
 * "pinged infra, waiting on deploy").
 *
 * `author_user_id` is `ON DELETE SET NULL` to preserve the comment
 * history when a user leaves — same policy as the audit `actor`
 * column. The comment body itself is the work product; attribution
 * is observable via email when the user exists.
 *
 * No edit/delete endpoints today. We may add them, but "I wrote
 * something, I want to take it back" is a different flow from
 * triage, and locking the body down matches the audit-trail
 * posture (events don't get rewritten either).
 */
export const adminTicketComments = pgTable('admin_ticket_comments', {
  id: uuid('id').defaultRandom().primaryKey(),
  ticketId: uuid('ticket_id')
    .notNull()
    .references(() => tickets.id, { onDelete: 'cascade' }),
  authorUserId: uuid('author_user_id').references(() => adminUsers.id, {
    onDelete: 'set null',
  }),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const adminTicketCommentsRelations = relations(adminTicketComments, ({ one }) => ({
  ticket: one(tickets, {
    fields: [adminTicketComments.ticketId],
    references: [tickets.id],
  }),
  author: one(adminUsers, {
    fields: [adminTicketComments.authorUserId],
    references: [adminUsers.id],
  }),
}));
