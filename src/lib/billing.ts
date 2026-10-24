import { eq } from "drizzle-orm";
import { db } from "@/db";
import { integrations } from "@/db/schema";
import { accountCredentials } from "@/lib/integration-service";
import type { ProposalLineItem } from "@/db/schema";

/**
 * InvoiceShelf is the money system of record: it prints the PDF, sends the email, records
 * payments and runs the reminders. The dashboard owns the commercial side (proposal →
 * project) and keeps a mirror row for visibility.
 *
 * On acceptance the invoice is pushed as a DRAFT. Nothing is emailed and nothing is
 * finalised — a person opens billing, checks it and approves sending. That is the
 * "automated, human approval" boundary: the machine does the typing, not the committing.
 *
 * Every function here is best-effort. A missing or broken billing connection must never
 * stop a client from accepting a proposal, so failures are reported, never thrown.
 */

export type BillingPushInput = {
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  clientName: string;
  clientEmail: string;
  notes: string;
  lines: ProposalLineItem[];
};

export type BillingPushResult =
  | { ok: true; id: string; number: string; url: string }
  | { ok: false; error: string };

const TIMEOUT_MS = 12_000;

function majorUnits(minor: number) {
  // InvoiceShelf stores decimal amounts; the dashboard stores integer centavos.
  return Math.round(minor) / 100;
}

type BillingAccount = { baseUrl: string; token: string };

async function loadAccount(): Promise<BillingAccount> {
  const [record] = await db.select().from(integrations).where(eq(integrations.key, "invoiceshelf")).limit(1);
  if (!record) throw new Error("The InvoiceShelf integration is not configured.");

  const baseUrl = (record.baseUrl || "").trim().replace(/\/+$/, "");
  if (!baseUrl) throw new Error("The InvoiceShelf integration has no instance URL.");

  const credentials = accountCredentials(record);
  const token = credentials.find((entry) => entry.token)?.token;
  if (!token) throw new Error("The InvoiceShelf integration has no usable token.");

  return { baseUrl, token };
}

async function call<T>(account: BillingAccount, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${account.baseUrl}/api/v1/${path.replace(/^\/+/, "")}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${account.token}`,
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const errors = (payload as { errors?: Record<string, string[]> } | null)?.errors;
    const firstError = errors ? Object.values(errors).flat()[0] : null;
    const message = firstError || (payload as { message?: string } | null)?.message || `HTTP ${response.status}`;
    throw new Error(String(message).slice(0, 300));
  }

  return payload as T;
}

/** InvoiceShelf has no unique customer key, so match on email first, then on exact name. */
async function resolveCustomerId(account: BillingAccount, name: string, email: string): Promise<number> {
  const listed = await call<{ data?: Array<{ id: number; name?: string; email?: string }> }>(
    account,
    "customers?limit=500",
    { method: "GET" }
  );
  const customers = listed?.data ?? [];

  const normalisedEmail = email.trim().toLowerCase();
  const byEmail = normalisedEmail ? customers.find((entry) => (entry.email || "").trim().toLowerCase() === normalisedEmail) : undefined;
  if (byEmail) return Number(byEmail.id);

  const byName = customers.find((entry) => (entry.name || "").trim().toLowerCase() === name.trim().toLowerCase());
  if (byName) return Number(byName.id);

  const created = await call<{ data?: { id: number } }>(account, "customers", {
    method: "POST",
    body: JSON.stringify({
      name: name.trim() || "Client",
      email: normalisedEmail || null,
      enable_portal: false,
    }),
  });
  const id = Number(created?.data?.id);
  if (!id) throw new Error("InvoiceShelf did not return the new customer id.");
  return id;
}

/**
 * Push a proposal's accepted total into InvoiceShelf as a draft invoice.
 * The dashboard's invoice number is reused verbatim so both systems show one number.
 */
export async function pushDraftInvoice(input: BillingPushInput): Promise<BillingPushResult> {
  try {
    if (input.currency !== "PHP") {
      return { ok: false, error: `InvoiceShelf is configured for PHP only; this proposal is in ${input.currency}. Create the invoice manually.` };
    }
    if (!input.lines.length) return { ok: false, error: "The proposal has no line items." };

    const account = await loadAccount();
    const customerId = await resolveCustomerId(account, input.clientName, input.clientEmail);

    const items = input.lines.map((line) => ({
      name: line.name.slice(0, 250),
      description: line.description,
      quantity: line.quantity,
      price: majorUnits(line.unitPriceMinor),
      tax: 0,
      discount_type: "fixed",
      discount_val: 0,
    }));

    const subtotal = input.lines.reduce((sum, line) => sum + line.totalMinor, 0);

    const created = await call<{ data?: { id: number; invoice_number?: string } }>(account, "invoices", {
      method: "POST",
      body: JSON.stringify({
        invoice_date: input.issueDate,
        due_date: input.dueDate,
        customer_id: customerId,
        invoice_number: input.invoiceNumber,
        template_name: "invoice1",
        discount: 0,
        discount_val: 0,
        tax: 0,
        sub_total: majorUnits(subtotal),
        total: majorUnits(subtotal),
        notes: input.notes,
        items,
      }),
    });

    const id = created?.data?.id;
    if (!id) return { ok: false, error: "InvoiceShelf did not return the created invoice id." };

    return {
      ok: true,
      id: String(id),
      number: created?.data?.invoice_number || input.invoiceNumber,
      url: `${account.baseUrl}/admin/invoices/${id}/edit`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown billing error";
    return { ok: false, error: message.slice(0, 300) };
  }
}
