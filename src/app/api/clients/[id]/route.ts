import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { agentJobs, clients } from "@/db/schema";
import { apiUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await apiUser("clients.view");
  if (response) return response;
  const { id } = await params;
  const [client] = await db.select().from(clients).where(and(eq(clients.id, id), eq(clients.workspaceId, user.workspaceId))).limit(1);
  if (!client) return Response.json({ error: "Client not found." }, { status: 404 });

  // The most recent agent job for this client, newest first. The detail page
  // renders this so it never shows an older failed attempt as the current state.
  const [latestJob] = await db
    .select({
      id: agentJobs.id,
      status: agentJobs.status,
      error: agentJobs.error,
      agent: agentJobs.agent,
      createdAt: agentJobs.createdAt,
      finishedAt: agentJobs.finishedAt,
    })
    .from(agentJobs)
    .where(and(eq(agentJobs.clientId, id), eq(agentJobs.workspaceId, user.workspaceId)))
    .orderBy(desc(agentJobs.createdAt))
    .limit(1);

  return Response.json({ client, latestJob: latestJob ?? null });
}
