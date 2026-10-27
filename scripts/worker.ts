// Background job worker for processing pending integration syncs
// Usage: npx tsx scripts/worker.ts (or compile and run with node)

import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { and, eq, lte } from "drizzle-orm";
import { db } from "@/db";
import { backgroundJobs, integrations } from "@/db/schema";
import { runIntegration } from "@/lib/integration-service";

async function processJobs() {
  const now = new Date();

  // Find queued jobs that are due to run
  const jobs = await db
    .select()
    .from(backgroundJobs)
    .where(and(eq(backgroundJobs.status, "queued"), lte(backgroundJobs.runAt, now)))
    .limit(10);

  if (!jobs.length) {
    console.log("No pending jobs to process.");
    return;
  }

  console.log(`Found ${jobs.length} job(s) to process.`);

  for (const job of jobs) {
    console.log(`Processing job ${job.id} (type: ${job.type})...`);

    // Mark job as running
    await db
      .update(backgroundJobs)
      .set({
        status: "running",
        attempts: job.attempts + 1,
        startedAt: new Date(),
      })
      .where(eq(backgroundJobs.id, job.id));

    try {
      const { integrationId, action } = job.payload as { integrationId: string; action: "test" | "sync" };

      if (!integrationId || !action) {
        throw new Error(`Invalid job payload: ${JSON.stringify(job.payload)}`);
      }

      // Fetch the integration record
      const [integration] = await db
        .select()
        .from(integrations)
        .where(eq(integrations.id, integrationId))
        .limit(1);

      if (!integration) {
        throw new Error(`Integration ${integrationId} not found`);
      }

      // Run the integration sync/test
      const result = await runIntegration(integration, action);

      // Mark job as succeeded
      await db
        .update(backgroundJobs)
        .set({
          status: "success",
          finishedAt: new Date(),
          error: null,
        })
        .where(eq(backgroundJobs.id, job.id));

      console.log(`Job ${job.id} completed successfully: ${result.detail}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`Job ${job.id} failed:`, message);

      // Mark job as failed
      await db
        .update(backgroundJobs)
        .set({
          status: "failed",
          finishedAt: new Date(),
          error: message,
        })
        .where(eq(backgroundJobs.id, job.id));
    }
  }
}

async function main() {
  console.log("Starting background job worker...");
  try {
    await processJobs();
    console.log("Worker finished.");
  } catch (error) {
    console.error("Worker error:", error);
    process.exit(1);
  } finally {
    // Close the database pool to allow clean exit
    const { pool } = await import("@/db");
    await pool.end();
  }
}

main();