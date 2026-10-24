import { and, desc, eq, like } from "drizzle-orm";
import { db } from "@/db";
import { invoices, projects } from "@/db/schema";
import type { ProposalLineItem } from "@/db/schema";

/**
 * Proposal domain rules.
 *
 * Money is always integer minor units (centavos). Totals are recomputed from the lines on
 * the server every time a proposal is written or accepted — a client-side total is never
 * trusted, and neither is a stored total once its lines are re-priced.
 *
 * Numbering (`INV-YYYYMM-###`, `PRJ-YYYYMM-###`) is per workspace and per month, matching
 * the unique indexes the schema already enforces.
 */

export const PROPOSAL_CURRENCIES = ["PHP", "USD", "EUR"] as const;
export type ProposalCurrency = (typeof PROPOSAL_CURRENCIES)[number];

export const PROPOSAL_STATUSES = ["draft", "sent", "accepted", "declined"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** Anything that can run a query: the pool-backed client or an open transaction. */
type Queryable = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export function lineTotalMinor(quantity: number, unitPriceMinor: number) {
  return Math.round(quantity * unitPriceMinor);
}

export function proposalTotalMinor(items: readonly Pick<ProposalLineItem, "quantity" | "unitPriceMinor">[]) {
  return items.reduce((sum, item) => sum + lineTotalMinor(item.quantity, item.unitPriceMinor), 0);
}

/** `YYYY-MM-DD` for the Postgres `date` columns. */
export function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function addDays(value: Date, days: number) {
  const next = new Date(value.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function monthPrefix(value: Date) {
  return `${value.getUTCFullYear()}${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function nextSequence(tx: Queryable, prefix: string, existing: string | undefined) {
  if (!existing) return `${prefix}001`;
  const parsed = Number.parseInt(existing.slice(prefix.length), 10);
  const next = Number.isFinite(parsed) && parsed > 0 ? parsed + 1 : 1;
  return `${prefix}${String(next).padStart(3, "0")}`;
}

/** Next invoice number in this workspace for the month of `when`, e.g. `INV-202610-003`. */
export async function nextInvoiceNumber(tx: Queryable, workspaceId: string, when = new Date()) {
  const prefix = `INV-${monthPrefix(when)}-`;
  const [row] = await tx
    .select({ number: invoices.invoiceNumber })
    .from(invoices)
    .where(and(eq(invoices.workspaceId, workspaceId), like(invoices.invoiceNumber, `${prefix}%`)))
    .orderBy(desc(invoices.invoiceNumber))
    .limit(1);
  return nextSequence(tx, prefix, row?.number);
}

/** Next project code in this workspace for the month of `when`, e.g. `PRJ-202610-004`. */
export async function nextProjectCode(tx: Queryable, workspaceId: string, when = new Date()) {
  const prefix = `PRJ-${monthPrefix(when)}-`;
  const [row] = await tx
    .select({ code: projects.code })
    .from(projects)
    .where(and(eq(projects.workspaceId, workspaceId), like(projects.code, `${prefix}%`)))
    .orderBy(desc(projects.code))
    .limit(1);
  return nextSequence(tx, prefix, row?.code);
}

/** Projects and invoices are created from the accepted lines, so keep the wording derived. */
export function projectDescription(items: readonly ProposalLineItem[]) {
  return items
    .map((item) => (item.description ? `${item.name} — ${item.description}` : item.name))
    .join("\n")
    .slice(0, 4000);
}

/** Fallback name for the created project when a proposal has no title. */
export function projectName(title: string, clientName: string | null) {
  const trimmed = title.trim();
  if (trimmed) return trimmed.slice(0, 200);
  return `Engagement for ${clientName?.trim() || "client"}`.slice(0, 200);
}
