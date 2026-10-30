import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { apiUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await apiUser("clients.view");
  if (response) return response;
  const { id } = await params;
  const [client] = await db.select().from(clients).where(and(eq(clients.id, id), eq(clients.workspaceId, user.workspaceId))).limit(1);
  if (!client) return Response.json({ error: "Client not found." }, { status: 404 });
  return Response.json({ client });
}
