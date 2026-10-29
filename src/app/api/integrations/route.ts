import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { integrations, syncRuns, workspaces } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { validateAgentToken } from "@/lib/agent-auth";
import { publicIntegration } from "@/lib/integration-service";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  // Machine clients (the health monitor, scheduled jobs) authenticate with the
  // agent bearer instead of a cookie.
  //
  // No role filter is applied on this path. The same token already unlocks
  // /api/agent/vault, so naming the integrations grants it nothing it did not
  // already hold, and filtering by a role an agent does not have would hide a
  // genuinely broken integration from the monitor that exists to catch it.
  if (validateAgentToken(request)) {
    const [workspace] = await db.select({ id: workspaces.id }).from(workspaces).limit(1);
    if (!workspace) return Response.json({ error: "No workspace is configured." }, { status: 404 });
    const records = await db.select().from(integrations).where(eq(integrations.workspaceId, workspace.id)).orderBy(integrations.name);
    const history = await db
      .select({ run: syncRuns, integrationName: integrations.name })
      .from(syncRuns)
      .innerJoin(integrations, eq(integrations.id, syncRuns.integrationId))
      .where(eq(integrations.workspaceId, workspace.id))
      .orderBy(desc(syncRuns.startedAt))
      .limit(30);
    return Response.json({ integrations: records.map(publicIntegration), history });
  }

  const { user, response } = await apiUser("integrations.view");
  if (response) return response;
  const records = await db.select().from(integrations).where(eq(integrations.workspaceId, user.workspaceId)).orderBy(integrations.name);
  const history = await db.select({ run: syncRuns, integrationName: integrations.name }).from(syncRuns).innerJoin(integrations, eq(integrations.id, syncRuns.integrationId)).where(eq(integrations.workspaceId, user.workspaceId)).orderBy(desc(syncRuns.startedAt)).limit(30);
  const permitted = records.filter((record) => !record.allowedRoles.length || record.allowedRoles.includes(user.roleSlug) || user.permissions.includes("*"));
  return Response.json({ integrations: permitted.map(publicIntegration), history: history.filter((row) => permitted.some((record) => record.id === row.run.integrationId)) });
}
