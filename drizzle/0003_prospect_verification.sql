ALTER TABLE "workspaces" ALTER COLUMN "brand_mark" SET DEFAULT 'PC';--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "verification" text DEFAULT 'unverified' NOT NULL;