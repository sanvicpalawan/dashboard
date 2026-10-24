import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, proposals } from "@/db/schema";
import { apiUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Read one proposal with its client. Scoped to the caller's workspace. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await apiUser("proposals.view");
  if (response) return response;

  const id = (await params).id;
  const [row] = await db
    .select({ proposal: proposals, clientName: clients.name, clientEmail: clients.email })
    .from(proposals)
    .leftJoin(clients, eq(clients.id, proposals.clientId))
    .where(and(eq(proposals.id, id), eq(proposals.workspaceId, user.workspaceId)))
    .limit(1);

  if (!row) return Response.json({ error: "Proposal not found." }, { status: 404 });

  return Response.json({
    proposal: { ...row.proposal, clientName: row.clientName, clientEmail: row.clientEmail },
    links: { public: `/proposal/${row.proposal.publicToken}` },
  });
}
