ALTER TABLE "agent_jobs" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD COLUMN "repeat_minutes" integer;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD COLUMN "schedule_key" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "brand_profile" jsonb DEFAULT 'null'::jsonb;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;