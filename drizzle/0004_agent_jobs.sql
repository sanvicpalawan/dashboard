CREATE TABLE "agent_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" uuid,
	"created_by_name" text DEFAULT '' NOT NULL,
	"project_id" uuid,
	"title" text NOT NULL,
	"instructions" text NOT NULL,
	"directory" text NOT NULL,
	"agent" text DEFAULT 'build' NOT NULL,
	"model" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"approval" text DEFAULT 'auto' NOT NULL,
	"approval_reason" text,
	"priority" integer DEFAULT 5 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 2 NOT NULL,
	"session_id" text,
	"result" text DEFAULT '' NOT NULL,
	"output" text DEFAULT '' NOT NULL,
	"error" text,
	"exit_code" integer,
	"worker" text,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_jobs_queue_idx" ON "agent_jobs" USING btree ("status","priority","run_at");--> statement-breakpoint
CREATE INDEX "agent_jobs_workspace_idx" ON "agent_jobs" USING btree ("workspace_id","created_at");
--> statement-breakpoint
UPDATE "roles" SET "permissions" = "permissions" || '["agent.view","agent.run","agent.manage"]'::jsonb WHERE ("permissions" @> '["tasks.manage"]'::jsonb OR "slug" = 'automation-operator') AND NOT ("permissions" @> '["agent.view"]'::jsonb);