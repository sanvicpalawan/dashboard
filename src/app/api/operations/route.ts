import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { automationRuns, backgroundJobs, integrations, syncRuns } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { runIntegration } from "@/lib/integration-service";
export const dynamic = "force-dynamic";
export async function GET() {
  const { user, response } = await apiUser("operations.view");
  if (response) return response;
  const [runs, jobs, failures] = await Promise.all([
    db.select().from(automationRuns).where(eq(automationRuns.workspaceId, user.workspaceId)).orderBy(desc(automationRuns.startedAt)).limit(100),
    db.select().from(backgroundJobs).where(eq(backgroundJobs.workspaceId, user.workspaceId)).orderBy(desc(backgroundJobs.createdAt)).limit(100),
    db.select({ run: syncRuns, provider: integrations.name }).from(syncRuns).innerJoin(integrations, eq(integrations.id, syncRuns.integrationId)).where(and(eq(integrations.workspaceId, user.workspaceId), eq(syncRuns.status, "failed"))).orderBy(desc(syncRuns.startedAt)).limit(30),
  ]);
  return Response.json({ runs, jobs, failures });
}
export async function POST(request: Request) {
  const { user, response } = await apiUser("operations.manage");
  if (response) return response;
  const parsed = z.object({ jobId: z.string().uuid(), confirmation: z.literal("RETRY") }).safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Type RETRY to confirm this background job action." }, { status: 400 });
  const [job] = await db.select().from(backgroundJobs).where(and(eq(backgroundJobs.id, parsed.data.jobId), eq(backgroundJobs.workspaceId, user.workspaceId))).limit(1);
  if (!job) return Response.json({ error: "Job not found." }, { status: 404 });
  if (job.status === "running") return Response.json({ error: "This job is already running." }, { status: 409 });
  if (job.type !== "integration.sync") return Response.json({ error: "No executable worker adapter is registered for this job type. Configure the owning service; the job was not requeued or marked successful." }, { status: 400 });
  const payload = job.payload as { provider?: string };
  const [integration] = await db.select().from(integrations).where(and(eq(integrations.workspaceId, user.workspaceId), eq(integrations.key, payload.provider || ""))).limit(1);
  if (!integration) return Response.json({ error: "The job's provider integration no longer exists." }, { status: 400 });
  await db.update(backgroundJobs).set({ status: "running", attempts: job.attempts + 1, startedAt: new Date(), finishedAt: null, error: null }).where(eq(backgroundJobs.id, job.id));
  try {
    const result = await runIntegration(integration, "sync");
    await db.update(backgroundJobs).set({ status: "success", finishedAt: new Date(), error: null }).where(eq(backgroundJobs.id, job.id));
    await audit(user, "job.retried", "background_job", job.id, { type: job.type, result: "success", records: result.count });
    return Response.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : "Retry failed.";
    await db.update(backgroundJobs).set({ status: "failed", finishedAt: new Date(), error: message }).where(eq(backgroundJobs.id, job.id));
    await audit(user, "job.retried", "background_job", job.id, { type: job.type, result: "failed", error: message });
    return Response.json({ error: message }, { status: 400 });
  }
}
