import { apiUser } from "@/lib/auth";
import { websiteLiveStatus } from "@/lib/website-live";

export const dynamic = "force-dynamic";

export async function GET() {
  const { user, response } = await apiUser("websites.view");
  if (response) return response;
  return Response.json(await websiteLiveStatus(user.workspaceId));
}
