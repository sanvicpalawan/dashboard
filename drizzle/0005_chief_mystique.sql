CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"project_id" uuid,
	"invoice_id" uuid,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"line_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total_minor" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'PHP' NOT NULL,
	"public_token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"accepted_at" timestamp with time zone,
	"signature_name" text DEFAULT '' NOT NULL,
	"ip_address" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_public_token_idx" ON "proposals" USING btree ("public_token");--> statement-breakpoint
CREATE INDEX "proposal_workspace_created_idx" ON "proposals" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "proposal_client_idx" ON "proposals" USING btree ("client_id");
--> statement-breakpoint
UPDATE "roles" SET "permissions" = "permissions" || '["proposals.view","proposals.manage"]'::jsonb WHERE ("permissions" @> '["finance.manage"]'::jsonb OR "permissions" @> '["clients.manage"]'::jsonb) AND NOT ("permissions" @> '["proposals.view"]'::jsonb);