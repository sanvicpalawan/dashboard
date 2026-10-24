import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { clients, proposals, services } from "@/db/schema";
import type { ProposalLineItem } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { PROPOSAL_CURRENCIES, lineTotalMinor, proposalTotalMinor } from "@/lib/proposals";

export const dynamic = "force-dynamic";

/**
 * Create a proposal draft.
 *
 * The client owns the lines; the server owns the money. Every line is either copied from a
 * catalogue service (priced rows can be authored by id alone) or supplied in full as a
 * bespoke line. `totalMinor` is always recomputed here so an API caller cannot under-declare
 * what the client will be shown or billed.
 */
const lineSchema = z.object({
  serviceId: z.string().uuid().nullish(),
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).default(""),
  quantity: z.number().positive().max(1000).default(1),
  unitPriceMinor: z.number().int().min(0).max(1_000_000_000).optional(),
});

const schema = z.object({
  clientId: z.string().uuid(),
  title: z.string().trim().min(2).max(200),
  currency: z.enum(PROPOSAL_CURRENCIES).default("PHP"),
  lineItems: z.array(lineSchema).min(1).max(50),
});

export async function POST(request: Request) {
  const { user, response } = await apiUser("proposals.manage");
  if (response) return response;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Invalid proposal." }, { status: 400 });

  const [client] = await db
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(and(eq(clients.id, parsed.data.clientId), eq(clients.workspaceId, user.workspaceId)))
    .limit(1);
  if (!client) return Response.json({ error: "Client not found in this workspace." }, { status: 404 });

  const serviceIds = [...new Set(parsed.data.lineItems.map((line) => line.serviceId).filter((id): id is string => Boolean(id)))];
  const catalogue = serviceIds.length
    ? await db
      .select({ id: services.id, name: services.name, description: services.description, setupFeeMinor: services.setupFeeMinor, recurringFeeMinor: services.recurringFeeMinor })
      .from(services)
      .where(and(eq(services.workspaceId, user.workspaceId), inArray(services.id, serviceIds)))
    : [];
  const byId = new Map(catalogue.map((service) => [service.id, service]));

  const lines: ProposalLineItem[] = [];
  for (const [index, line] of parsed.data.lineItems.entries()) {
    const service = line.serviceId ? byId.get(line.serviceId) : undefined;
    if (line.serviceId && !service) return Response.json({ error: `Line ${index + 1} references a service that is not in this workspace.` }, { status: 400 });
    const name = line.name || service?.name;
    const unitPriceMinor = line.unitPriceMinor ?? service?.setupFeeMinor;
    if (!name) return Response.json({ error: `Line ${index + 1} needs a name.` }, { status: 400 });
    if (unitPriceMinor === undefined) return Response.json({ error: `Line ${index + 1} needs a unit price.` }, { status: 400 });
    lines.push({
      serviceId: service?.id ?? null,
      name,
      description: line.description || service?.description || "",
      quantity: line.quantity,
      unitPriceMinor,
      totalMinor: lineTotalMinor(line.quantity, unitPriceMinor),
    });
  }

  const [proposal] = await db
    .insert(proposals)
    .values({
      workspaceId: user.workspaceId,
      clientId: client.id,
      title: parsed.data.title,
      status: "draft",
      lineItems: lines,
      totalMinor: proposalTotalMinor(lines),
      currency: parsed.data.currency,
    })
    .returning();

  await audit(user, "proposal.created", "proposal", proposal.id, {
    clientId: client.id,
    clientName: client.name,
    lines: lines.length,
    totalMinor: proposal.totalMinor,
    currency: proposal.currency,
  });

  return Response.json({ proposal: { ...proposal, clientName: client.name } }, { status: 201 });
}
