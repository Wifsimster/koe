-- Simplify user management: Koe is a single-admin product, not team software.
-- Credentials live in env vars (ADMIN_EMAIL + ADMIN_PASSWORD_HASH); the session
-- is a signed cookie. The user/session/member tables and their referencing
-- columns are all unnecessary.
--
-- Destructive. Pre-release, no data-preservation path.

-- Drop dependent columns first so the parent tables can be removed.
ALTER TABLE "tickets" DROP COLUMN IF EXISTS "assigned_to_user_id";--> statement-breakpoint
ALTER TABLE "admin_ticket_events" DROP COLUMN IF EXISTS "actor_user_id";--> statement-breakpoint
ALTER TABLE "admin_ticket_comments" DROP COLUMN IF EXISTS "author_user_id";--> statement-breakpoint

DROP TABLE IF EXISTS "project_members";--> statement-breakpoint
DROP TABLE IF EXISTS "admin_sessions";--> statement-breakpoint
DROP TABLE IF EXISTS "admin_users";--> statement-breakpoint

DROP TYPE IF EXISTS "project_member_role";--> statement-breakpoint

-- Drop the `assigned` value from the event kind enum. Postgres doesn't
-- support dropping enum values directly — recreate the type.
ALTER TYPE "ticket_event_kind" RENAME TO "ticket_event_kind_old";--> statement-breakpoint
CREATE TYPE "ticket_event_kind" AS ENUM ('status_changed', 'priority_changed', 'commented');--> statement-breakpoint
ALTER TABLE "admin_ticket_events"
  ALTER COLUMN "kind" TYPE "ticket_event_kind"
  USING "kind"::text::"ticket_event_kind";--> statement-breakpoint
DROP TYPE "ticket_event_kind_old";
