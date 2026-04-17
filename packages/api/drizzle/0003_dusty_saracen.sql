ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "assigned_to_user_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assigned_to_user_id_admin_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
