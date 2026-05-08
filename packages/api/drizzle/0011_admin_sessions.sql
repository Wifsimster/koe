-- Server-side admin session registry. Pairs the SHA-256 hash of a
-- session cookie value with its expiry so an admin can kick a single
-- device (one-row DELETE) without rotating ADMIN_SESSION_SECRET (which
-- would kick every browser at once).
--
-- The cookie value itself is never stored — only its hash. A DB dump
-- never leaks an active credential.

CREATE TABLE IF NOT EXISTS "admin_sessions" (
  "token_hash" text PRIMARY KEY NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "admin_sessions_expires_at_idx"
  ON "admin_sessions" ("expires_at");
