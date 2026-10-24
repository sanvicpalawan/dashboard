import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditEvents, clients, invoices, proposals, projects } from "@/db/schema";
import type { ProposalRecord } from "@/db/schema";
import { pushDraftInvoice } from "@/lib/billing";
import { checkRateLimit } from "@/lib/security";
import { addDays, isoDate, nextInvoiceNumber, nextProjectCode, proposalTotalMinor, projectDescription, projectName } from "@/lib/proposals";

export const dynamic = "force-dynamic";

/**
 * Public acceptance endpoint. No session, no cookie — the unguessable `public_token` on the
 * proposal is the credential, and it is only ever compared against the row it belongs to.
 *
 * In one transaction: lock the proposal, mark it accepted with the signature and IP, create
 * the project from the accepted lines, and create a draft invoice for the agreed total.
 *
 * Safe to call twice. An already-accepted proposal returns the same project and invoice
 * instead of creating duplicates, which matters because a client will refresh the page and
 * may submit twice on a slow connection.
 */
const schema = z.object({
  token: z.string().uuid(),
  signatureName: z.string().trim().min(2, "Enter the full name of the person accepting.").max(120),
});

type Accepted = {
  kind: "accepted" | "already";
  proposal: ProposalRecord;
  projectId: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  projectCode: string | null;
  clientName: string;
  clientEmail: string;
};

function clientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  const first = forwarded.split(",")[0]?.trim();
  return (first || request.headers.get("x-real-ip") || "").slice(0, 64);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ip = clientIp(request);
  const limit = checkRateLimit(`proposal-accept:${ip}`, 10, 60_000);
  if (!limit.allowed) {
    return Response.json({ error: `Too many attempts. Try again in ${limit.retryAfter} seconds.` }, { status: 429 });
  }

  const id = (await params).id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return Response.json({ error: "Proposal not found." }, { status: 404 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Invalid acceptance." }, { status: 400 });
  const { token, signatureName } = parsed.data;

  const result = await db.transaction(async (tx) => {
    const [proposal] = await tx
      .select()
      .from(proposals)
      .where(and(eq(proposals.id, id), eq(proposals.publicToken, token)))
      .limit(1)
      .for("update");

    if (!proposal) return { kind: "not_found" as const };
    if (proposal.status === "declined") return { kind: "declined" as const };
    if (proposal.status === "accepted") {
      return {
        kind: "already" as const,
        proposal,
        projectId: proposal.projectId,
        invoiceId: proposal.invoiceId,
        invoiceNumber: null,
        projectCode: null,
        clientName: "",
        clientEmail: "",
      } satisfies Accepted;
    }

    const [client] = await tx
      .select({ id: clients.id, name: clients.name, email: clients.email })
      .from(clients)
      .where(and(eq(clients.id, proposal.clientId), eq(clients.workspaceId, proposal.workspaceId)))
      .limit(1);

    const total = proposalTotalMinor(proposal.lineItems) || proposal.totalMinor;
    const acceptedAt = new Date();
    const issueDate = isoDate(acceptedAt);
    const dueDate = isoDate(addDays(acceptedAt, 14));

    const projectCode = await nextProjectCode(tx, proposal.workspaceId, acceptedAt);
    const invoiceNumber = await nextInvoiceNumber(tx, proposal.workspaceId, acceptedAt);

    const [project] = await tx
      .insert(projects)
      .values({
        workspaceId: proposal.workspaceId,
        clientId: proposal.clientId,
        name: projectName(proposal.title, client?.name ?? null),
        code: projectCode,
        description: projectDescription(proposal.lineItems),
        status: "active",
        priority: "medium",
        progress: 0,
        startDate: issueDate,
        deliverables: proposal.lineItems.map((line) => line.name).slice(0, 100),
        budgetMinor: total,
        currency: proposal.currency,
      })
      .returning();

    const [invoice] = await tx
      .insert(invoices)
      .values({
        workspaceId: proposal.workspaceId,
        clientId: proposal.clientId,
        invoiceNumber,
        status: "draft",
        issueDate,
        dueDate,
        currency: proposal.currency,
        subtotalMinor: total,
        taxMinor: 0,
        totalMinor: total,
        amountPaidMinor: 0,
        source: "proposal",
        externalRef: proposal.id,
      })
      .returning();

    const [accepted] = await tx
      .update(proposals)
      .set({
        status: "accepted",
        acceptedAt,
        signatureName,
        ipAddress: ip,
        projectId: project.id,
        invoiceId: invoice.id,
        totalMinor: total,
        updatedAt: acceptedAt,
      })
      .where(eq(proposals.id, proposal.id))
      .returning();

    await tx.insert(auditEvents).values({
      workspaceId: proposal.workspaceId,
      userId: null,
      action: "proposal.accepted",
      entityType: "proposal",
      entityId: proposal.id,
      ipAddress: ip,
      metadata: {
        signatureName,
        totalMinor: total,
        currency: proposal.currency,
        projectId: project.id,
        projectCode,
        invoiceId: invoice.id,
        invoiceNumber,
      },
    });

    return {
      kind: "accepted" as const,
      proposal: accepted,
      projectId: project.id,
      invoiceId: invoice.id,
      invoiceNumber,
      projectCode,
      clientName: client?.name ?? "",
      clientEmail: client?.email ?? "",
    } satisfies Accepted;
  });

  if (result.kind === "not_found") return Response.json({ error: "Proposal not found." }, { status: 404 });
  if (result.kind === "declined") return Response.json({ error: "This proposal was declined and can no longer be accepted." }, { status: 409 });

  /**
   * Hand the accepted total to InvoiceShelf as a DRAFT invoice. This is deliberately outside
   * the transaction and deliberately allowed to fail: the client has already accepted, and a
   * billing outage must not turn a signed proposal into an error page. A failure is recorded
   * as an audit event so it can be retried, and the dashboard invoice still exists as the
   * internal record either way.
   */
  if (result.kind === "accepted" && result.invoiceId && result.invoiceNumber) {
    const proposal = result.proposal;
    const billing = await pushDraftInvoice({
      invoiceNumber: result.invoiceNumber,
      issueDate: isoDate(new Date(proposal.acceptedAt ?? new Date())),
      dueDate: isoDate(addDays(new Date(proposal.acceptedAt ?? new Date()), 14)),
      currency: proposal.currency,
      clientName: result.clientName,
      clientEmail: result.clientEmail,
      notes: proposal.title,
      lines: proposal.lineItems,
    });

    if (billing.ok) {
      await db
        .update(invoices)
        .set({
          source: "invoiceshelf",
          externalRef: JSON.stringify({ provider: "invoiceshelf", id: billing.id, number: billing.number, url: billing.url }),
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, result.invoiceId));

      await db.insert(auditEvents).values({
        workspaceId: proposal.workspaceId,
        userId: null,
        action: "invoice.pushed_to_billing",
        entityType: "invoice",
        entityId: result.invoiceId,
        metadata: { billingId: billing.id, billingNumber: billing.number },
      });
    } else {
      await db.insert(auditEvents).values({
        workspaceId: proposal.workspaceId,
        userId: null,
        action: "invoice.billing_push_failed",
        entityType: "invoice",
        entityId: result.invoiceId,
        metadata: { error: billing.error },
      });
    }
  }

  return Response.json({
    ok: true,
    alreadyAccepted: result.kind === "already",
    proposal: {
      id: result.proposal.id,
      status: result.proposal.status,
      acceptedAt: result.proposal.acceptedAt,
      signatureName: result.proposal.signatureName,
      totalMinor: result.proposal.totalMinor,
      currency: result.proposal.currency,
    },
    projectId: result.projectId,
    invoiceId: result.invoiceId,
    invoiceNumber: result.invoiceNumber,
    projectCode: result.projectCode,
  });
}
