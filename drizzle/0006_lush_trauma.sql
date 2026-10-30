ALTER TABLE "agent_jobs" ADD COLUMN IF NOT EXISTS "client_id" uuid;
ALTER TABLE "agent_jobs" ADD COLUMN IF NOT EXISTS "repeat_minutes" integer;
ALTER TABLE "agent_jobs" ADD COLUMN IF NOT EXISTS "schedule_key" text;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "brand_profile" jsonb DEFAULT 'null'::jsonb;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_jobs_client_id_clients_id_fk') THEN ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL ON UPDATE NO ACTION; END IF; END $$;
