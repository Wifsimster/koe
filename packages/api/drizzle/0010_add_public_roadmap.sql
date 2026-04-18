-- Add opt-in public-roadmap flag on tickets and a matching audit event.
-- Admins toggle `is_public_roadmap` per ticket from the dashboard; tickets
-- with the flag set are rendered on the unauthenticated /r/:projectKey page.
-- Default false so nothing is published until curated.

ALTER TYPE "ticket_event_kind" ADD VALUE IF NOT EXISTS 'roadmap_toggled';--> statement-breakpoint

ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "is_public_roadmap" boolean NOT NULL DEFAULT false;--> statement-breakpoint

-- Partial index so the public-page query stays cheap as the tickets
-- table grows. Matches `WHERE is_public_roadmap = true` with a status
-- filter (planned / in_progress / resolved), which is the only read
-- path that cares about this flag.
CREATE INDEX IF NOT EXISTS "tickets_project_public_roadmap_idx"
  ON "tickets" ("project_id", "status")
  WHERE "is_public_roadmap" = true;
