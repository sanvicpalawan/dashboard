import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { agentJobs, appSettings } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { WORKER_HEARTBEAT_KEY, workerStatus, type WorkerHeartbeat } from "@/lib/agent-jobs";
import { allowedRoots } from "@/lib/agent-policy";

export const dynamic = "force-dynamic";

export async function GET() {
  const { user, response } = await apiUser("agent.view");
  if (response) return response;

  const [heartbeatRow] = await db.select().from(appSettings).where(eq(appSettings.key, WORKER_HEARTBEAT_KEY)).limit(1);
  const heartbeat = (heartbeatRow?.value as WorkerHeartbeat | undefined) ?? null;
  const status = workerStatus(heartbeat);

  const counts = await db.select({ status: agentJobs.status, count: sql<number>`count(*)::int` })
    .from(agentJobs)
    .where(eq(agentJobs.workspaceId, user.workspaceId))
    .groupBy(agentJobs.status);
  const byStatus = Object.fromEntries(counts.map((row) => [row.status, row.count]));
  const active = await db.select({ id: agentJobs.id }).from(agentJobs)
    .where(and(eq(agentJobs.workspaceId, user.workspaceId), inArray(agentJobs.status, ["queued", "awaiting_approval", "running"])));

  return Response.json({ worker: status, counts: byStatus, active: active.length, allowedRoots: allowedRoots() });
}
