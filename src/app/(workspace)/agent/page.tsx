import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { agentJobs, appSettings } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { allowedRoots } from "@/lib/agent-policy";
import { WORKER_HEARTBEAT_KEY, publicAgentJob, workerStatus, type WorkerHeartbeat } from "@/lib/agent-jobs";
import { AgentQueue } from "@/components/agent-queue";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agent queue" };

export default async function AgentPage() {
  const user = await requireUser("agent.view");

  const [rows, heartbeatRow, active, queued, running, awaiting, failed] = await Promise.all([
    db.select().from(agentJobs).where(eq(agentJobs.workspaceId, user.workspaceId)).orderBy(desc(agentJobs.createdAt)).limit(60),
    db.select().from(appSettings).where(eq(appSettings.key, WORKER_HEARTBEAT_KEY)).limit(1),
    db.select({ id: agentJobs.id }).from(agentJobs).where(and(eq(agentJobs.workspaceId, user.workspaceId), inArray(agentJobs.status, ["queued", "awaiting_approval", "running"]))),
    db.select({ id: agentJobs.id }).from(agentJobs).where(and(eq(agentJobs.workspaceId, user.workspaceId), eq(agentJobs.status, "queued"))),
    db.select({ id: agentJobs.id }).from(agentJobs).where(and(eq(agentJobs.workspaceId, user.workspaceId), eq(agentJobs.status, "running"))),
    db.select({ id: agentJobs.id }).from(agentJobs).where(and(eq(agentJobs.workspaceId, user.workspaceId), eq(agentJobs.status, "awaiting_approval"))),
    db.select({ id: agentJobs.id }).from(agentJobs).where(and(eq(agentJobs.workspaceId, user.workspaceId), eq(agentJobs.status, "failed"))),
  ]);

  const heartbeat = (heartbeatRow[0]?.value as WorkerHeartbeat | undefined) ?? null;

  return <AgentQueue
    user={user}
    initialJobs={rows.map(publicAgentJob)}
    initialStatus={{
      worker: workerStatus(heartbeat),
      counts: { queued: queued.length, running: running.length, awaiting_approval: awaiting.length, failed: failed.length },
      active: active.length,
      allowedRoots: allowedRoots(),
    }}
  />;
}
