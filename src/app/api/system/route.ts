import { db } from "@/db";
import { workspaces } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { systemSnapshot } from "@/lib/system";

export const dynamic = "force-dynamic";

/**
 * GET /api/system — what the server is doing right now.
 *
 * Host CPU, memory and disk come from /proc and statfs inside the container
 * (the dashboard runs on the VPS itself). The container list comes from the
 * Coolify API using the stored integration credential, so nothing is
 * hard-coded and a rotated token takes effect immediately.
 *
 * Two ways in: a signed-in account with operations.view, or the agent bearer
 * secret used by the nightly jobs and OpenCode (single-workspace deployment).
 */
export async function GET(request: Request) {
  const agentSecret = process.env.AGENT_VAULT_SECRET;
  const authorisedAgent = Boolean(agentSecret) && request.headers.get("Authorization") === `Bearer ${agentSecret}`;

  let workspaceId: string | null = null;
  if (authorisedAgent) {
    const [workspace] = await db.select({ id: workspaces.id }).from(workspaces).limit(1);
    workspaceId = workspace?.id ?? null;
  } else {
    const { user, response } = await apiUser("operations.view");
    if (response) return response;
    workspaceId = user.workspaceId;
  }

  if (!workspaceId) return Response.json({ error: "No workspace is configured." }, { status: 404 });
  return Response.json(await systemSnapshot(workspaceId));
}
