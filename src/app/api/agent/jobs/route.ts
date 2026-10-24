import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { agentJobs } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { AGENT_STATUSES, allowedRoots, checkDirectory, checkInstructions, checkModel } from "@/lib/agent-policy";
import { createJobSchema, publicAgentJob } from "@/lib/agent-jobs";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { user, response } = await apiUser("agent.view");
  if (response) return response;
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const limit = Math.min(Number(url.searchParams.get("limit") || 60) || 60, 200);
  const filters = [eq(agentJobs.workspaceId, user.workspaceId)];
  if (status && (AGENT_STATUSES as readonly string[]).includes(status)) filters.push(eq(agentJobs.status, status));
  const rows = await db.select().from(agentJobs).where(and(...filters)).orderBy(desc(agentJobs.createdAt)).limit(limit);
  const active = await db.select({ id: agentJobs.id }).from(agentJobs)
    .where(and(eq(agentJobs.workspaceId, user.workspaceId), inArray(agentJobs.status, ["queued", "awaiting_approval", "running"])));
  return Response.json({ jobs: rows.map(publicAgentJob), active: active.length, allowedRoots: allowedRoots() });
}

export async function POST(request: Request) {
  const { user, response } = await apiUser("agent.run");
  if (response) return response;

  const parsed = createJobSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Job validation failed." }, { status: 400 });
  const input = parsed.data;

  const directory = checkDirectory(input.directory);
  if (!directory.ok) return Response.json({ error: directory.error }, { status: 400 });

  const model = checkModel(input.model);
  if (!model.ok) return Response.json({ error: model.error }, { status: 400 });

  const guard = checkInstructions(`${input.title}\n${input.instructions}`);
  const approval = input.approval === "required" || guard.blocked ? "required" : "auto";

  const [job] = await db.insert(agentJobs).values({
    workspaceId: user.workspaceId,
    createdBy: user.id,
    createdByName: user.name,
    projectId: input.projectId ?? null,
    title: input.title,
    instructions: input.instructions,
    directory: input.directory,
    agent: input.agent || "build",
    model: input.model || null,
    status: approval === "required" ? "awaiting_approval" : "queued",
    approval,
    approvalReason: guard.blocked ? guard.reasons.join(" ") : input.approval === "required" ? "Approval requested when the job was created." : null,
    priority: input.priority ?? 5,
    maxAttempts: input.maxAttempts ?? 2,
    repeatMinutes: input.repeatMinutes ?? null,
    scheduleKey: input.repeatMinutes ? `job:${crypto.randomUUID()}` : null,
  }).returning();

  await audit(user, "agent.job.created", "agent_job", job.id, { title: job.title, directory: job.directory, approval: job.approval, status: job.status });
  return Response.json({ job: publicAgentJob(job) }, { status: 201 });
}
