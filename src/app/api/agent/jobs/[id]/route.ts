import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { agentJobs } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { publicAgentJob, jobActionSchema } from "@/lib/agent-jobs";

export const dynamic = "force-dynamic";

async function loadJob(workspaceId: string, id: string) {
  const [row] = await db.select().from(agentJobs).where(and(eq(agentJobs.id, id), eq(agentJobs.workspaceId, workspaceId))).limit(1);
  return row ?? null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await apiUser("agent.view");
  if (response) return response;
  const job = await loadJob(user.workspaceId, (await params).id);
  if (!job) return Response.json({ error: "Job not found." }, { status: 404 });
  return Response.json({ job: publicAgentJob(job) });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
  const parsed = jobActionSchema.safeParse(body ?? {});
  if (!parsed.success) return Response.json({ error: "Unsupported action. Use cancel, retry or approve." }, { status: 400 });
  const action = parsed.data.action;
  const permission = action === "approve" ? "agent.manage" : "agent.run";
  const { user, response } = await apiUser(permission);
  if (response) return response;

  const id = (await params).id;
  const job = await loadJob(user.workspaceId, id);
  if (!job) return Response.json({ error: "Job not found." }, { status: 404 });
  const now = new Date();

  if (action === "cancel") {
    if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") {
      return Response.json({ error: `A ${job.status} job cannot be cancelled. Retry it instead.` }, { status: 409 });
    }
    const [updated] = await db.update(agentJobs)
      .set({ status: "cancelled", error: job.status === "running" ? "Cancelled by an operator while running." : job.error, finishedAt: now, updatedAt: now })
      .where(and(eq(agentJobs.id, id), eq(agentJobs.workspaceId, user.workspaceId))).returning();
    await audit(user, "agent.job.cancelled", "agent_job", id, { previousStatus: job.status });
    return Response.json({ job: publicAgentJob(updated) });
  }

  if (action === "approve") {
    if (job.status !== "awaiting_approval") {
      return Response.json({ error: "Only jobs awaiting approval can be approved." }, { status: 409 });
    }
    const [updated] = await db.update(agentJobs)
      .set({ status: "queued", approval: "approved", runAt: now, error: null, finishedAt: null, updatedAt: now })
      .where(and(eq(agentJobs.id, id), eq(agentJobs.workspaceId, user.workspaceId))).returning();
    await audit(user, "agent.job.approved", "agent_job", id, { reason: job.approvalReason, approvedBy: user.email });
    return Response.json({ job: publicAgentJob(updated) });
  }

  if (action === "retry") {
    if (job.status === "running") return Response.json({ error: "Cancel the running job before retrying it." }, { status: 409 });
    const [updated] = await db.update(agentJobs)
      .set({ status: "queued", attempts: 0, error: null, exitCode: null, runAt: now, startedAt: null, finishedAt: null, output: "", result: "", updatedAt: now })
      .where(and(eq(agentJobs.id, id), eq(agentJobs.workspaceId, user.workspaceId))).returning();
    await audit(user, "agent.job.retried", "agent_job", id, { previousStatus: job.status });
    return Response.json({ job: publicAgentJob(updated) });
  }

  return Response.json({ error: "Unsupported action. Use cancel, retry or approve." }, { status: 400 });
}
