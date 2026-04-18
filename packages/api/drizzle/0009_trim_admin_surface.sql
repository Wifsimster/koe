-- Trim the admin surface further now that the product is officially
-- single-admin-only:
--
--   - Drop admin_ticket_comments: a joined comments table is overkill
--     for one operator's internal notes. One nullable text column on
--     tickets replaces it.
--   - Drop admin_ticket_events.batch_id and its consumers (BatchesPage,
--     /events/batches endpoints): a solo founder doing their own bulk
--     action already knows what they just did; per-event undo covers
--     mistakes.
--   - Drop the `commented` value from the event kind enum — comments
--     are gone, so the event kind has nothing to emit.
--
-- Destructive. Pre-release, no data-preservation path.

ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "notes" text;--> statement-breakpoint

DROP TABLE IF EXISTS "admin_ticket_comments";--> statement-breakpoint

ALTER TABLE "admin_ticket_events" DROP COLUMN IF EXISTS "batch_id";--> statement-breakpoint

-- Drop the `commented` value from the event kind enum. Postgres
-- doesn't support dropping enum values directly, so recreate the type.
-- Any residual `commented` rows would block the USING cast — delete
-- them first. No-op on a fresh install.
DELETE FROM "admin_ticket_events" WHERE "kind" = 'commented';--> statement-breakpoint
ALTER TYPE "ticket_event_kind" RENAME TO "ticket_event_kind_old";--> statement-breakpoint
CREATE TYPE "ticket_event_kind" AS ENUM ('status_changed', 'priority_changed');--> statement-breakpoint
ALTER TABLE "admin_ticket_events"
  ALTER COLUMN "kind" TYPE "ticket_event_kind"
  USING "kind"::text::"ticket_event_kind";--> statement-breakpoint
DROP TYPE "ticket_event_kind_old";
