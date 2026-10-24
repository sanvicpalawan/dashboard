import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, projects, prospects } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * Turns a won prospect into a client and its first project.
 *
 * Until this existed the pipeline could never become revenue: a lead could be
 * edited, pitched and marked won, and still no client or project was ever
 * created. The conversion is deliberately one action with no form — the data is
 * already on the record, and asking the operator to retype it is how records
 * drift apart.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await apiUser("leads.manage");
  if (response) return response;
  const { id } = await params;

  const [prospect] = await db
    .select()
    .from(prospects)
    .where(and(eq(prospects.id, id), eq(prospects.workspaceId, user.workspaceId)))
    .limit(1);
  if (!prospect) return Response.json({ error: "Prospect not found." }, { status: 404 });

  const existing = await db
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(and(eq(clients.workspaceId, user.workspaceId), eq(clients.name, prospect.businessName)))
    .limit(1);
  if (existing.length) {
    return Response.json({ error: `A client named "${prospect.businessName}" already exists.`, clientId: existing[0].id }, { status: 409 });
  }

  const service = prospect.pitchedServices[0] || "Digital presence";
  const code = `${prospect.businessName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 28)}-${Math.random().toString(36).slice(2, 6)}`;

  const [client] = await db
    .insert(clients)
    .values({
      workspaceId: user.workspaceId,
      ownerId: prospect.ownerId ?? user.id,
      name: prospect.businessName,
      industry: prospect.industry,
      location: prospect.location,
      status: "active",
      contactName: prospect.contactName,
      email: prospect.email,
      phone: prospect.phone,
      servicePlan: service,
      notes: prospect.notes,
      links: [
        ...(prospect.website ? [{ label: "Website", url: prospect.website }] : []),
        ...prospect.socialLinks
          .split(/[\s,]+/)
          .filter((link) => /^https?:\/\//.test(link))
          .slice(0, 3)
          .map((url) => ({ label: new URL(url).hostname.replace(/^www\./, ""), url })),
      ],
    })
    .returning();

  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: user.workspaceId,
      clientId: client.id,
      name: `${prospect.businessName} — ${service}`,
      code,
      description: `Won from the prospect list. Source: ${prospect.source || "unknown"}. Verification at conversion: ${prospect.verification}.`,
      status: "active",
      priority: "high",
      progress: 0,
      deliverables: prospect.pitchedServices,
      budgetMinor: prospect.estimatedValueMinor,
      currency: "PHP",
    })
    .returning();

  await db
    .update(prospects)
    .set({ stage: "won", updatedAt: new Date() })
    .where(eq(prospects.id, prospect.id));

  await audit(user, "client.converted", "prospect", prospect.id, {
    clientId: client.id,
    projectId: project.id,
    businessName: prospect.businessName,
  });

  return Response.json({ client: { id: client.id, name: client.name }, project: { id: project.id, code: project.code, name: project.name } }, { status: 201 });
}
