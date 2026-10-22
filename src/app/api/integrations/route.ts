import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { integrations, syncRuns } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { publicIntegration } from "@/lib/integration-service";

export const dynamic = "force-dynamic";
export async function GET() {
  const { user, response } = await apiUser("integrations.view");
  if (response) return response;
  const records = await db.select().from(integrations).where(eq(integrations.workspaceId, user.workspaceId)).orderBy(integrations.name);
  const history = await db.select({ run: syncRuns, integrationName: integrations.name }).from(syncRuns).innerJoin(integrations, eq(integrations.id, syncRuns.integrationId)).where(eq(integrations.workspaceId, user.workspaceId)).orderBy(desc(syncRuns.startedAt)).limit(30);
  const permitted = records.filter((record) => !record.allowedRoles.length || record.allowedRoles.includes(user.roleSlug) || user.permissions.includes("*"));
  return Response.json({ integrations: permitted.map(publicIntegration), history: history.filter((row) => permitted.some((record) => record.id === row.run.integrationId)) });
}
