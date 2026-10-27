import { apiUser } from "@/lib/auth";
import { systemSnapshot } from "@/lib/system";

export const dynamic = "force-dynamic";

/**
 * GET /api/system — what the campaign server is doing right now.
 *
 * Host CPU, memory and disk come from /proc and statfs inside the container
 * (the dashboard runs on the VPS itself). The container list comes from the
 * Coolify API using the stored integration credential, so nothing is
 * hard-coded and a rotated token takes effect immediately.
 */
export async function GET() {
  const { user, response } = await apiUser("operations.view");
  if (response) return response;
  const snapshot = await systemSnapshot(user.workspaceId);
  return Response.json(snapshot);
}
