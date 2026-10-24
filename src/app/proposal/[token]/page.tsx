import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, proposals, workspaces } from "@/db/schema";
import { AcceptForm } from "./accept-form";
import "./proposal.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Proposal", robots: { index: false, follow: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function money(amountMinor: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-PH", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amountMinor / 100);
  } catch {
    return `${currency} ${(amountMinor / 100).toFixed(2)}`;
  }
}

function longDate(value: Date | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "long", timeZone: "Asia/Manila" }).format(value);
}

/**
 * Public proposal page. Reachable by anyone holding the token, so it renders only what the
 * client needs to decide: who it is from, who it is for, what is being delivered, what it
 * costs, and the acceptance block. No internal ids, links or comments leak into it.
 */
export default async function ProposalPage({ params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token;
  if (!UUID.test(token)) notFound();

  const [row] = await db
    .select({
      proposal: proposals,
      clientName: clients.name,
      clientContact: clients.contactName,
      clientLocation: clients.location,
      workspaceName: workspaces.name,
      legalName: workspaces.legalName,
    })
    .from(proposals)
    .leftJoin(clients, eq(clients.id, proposals.clientId))
    .leftJoin(workspaces, eq(workspaces.id, proposals.workspaceId))
    .where(eq(proposals.publicToken, token))
    .limit(1);

  if (!row) notFound();

  const { proposal } = row;
  const issuer = row.legalName || row.workspaceName || "Palawan Collective";
  const accepted = proposal.status === "accepted";
  const declined = proposal.status === "declined";

  return (
    <main className="proposal-page">
      <header className="proposal-head">
        <div>
          <div className="proposal-issuer">{issuer}</div>
          <h1>{proposal.title}</h1>
          <p className="proposal-meta">
            Prepared for {row.clientContact || row.clientName || "client"}
            {row.clientLocation ? ` · ${row.clientLocation}` : ""}
          </p>
        </div>
        <span className={`proposal-status proposal-status-${proposal.status}`}>
          {accepted ? "Accepted" : declined ? "Declined" : proposal.status === "sent" ? "Awaiting signature" : "Draft"}
        </span>
      </header>

      <section className="proposal-body" aria-label="Proposal line items">
        <table className="proposal-table">
          <thead>
            <tr>
              <th scope="col">Deliverable</th>
              <th scope="col">Qty</th>
              <th scope="col">Unit price</th>
              <th scope="col">Amount</th>
            </tr>
          </thead>
          <tbody>
            {proposal.lineItems.map((line, index) => (
              <tr key={`${line.serviceId ?? "custom"}-${index}`}>
                <td>
                  <strong>{line.name}</strong>
                  {line.description ? <span>{line.description}</span> : null}
                </td>
                <td>{line.quantity}</td>
                <td>{money(line.unitPriceMinor, proposal.currency)}</td>
                <td>{money(line.totalMinor, proposal.currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={3}>Total</th>
              <td>{money(proposal.totalMinor, proposal.currency)}</td>
            </tr>
          </tfoot>
        </table>
        <p className="proposal-terms">
          Amounts are in {proposal.currency} and exclusive of any third-party fees stated in the line descriptions.
          A 50% deposit is due on acceptance; the balance is due within 14 days of delivery unless agreed otherwise.
        </p>
      </section>

      {accepted ? (
        <section className="proposal-accepted" aria-label="Acceptance record">
          <h2>Acceptance confirmed</h2>
          <p>
            Accepted by <strong>{proposal.signatureName || "the client"}</strong>
            {proposal.acceptedAt ? ` on ${longDate(proposal.acceptedAt)}` : ""}. A project and an invoice have been
            created and {issuer} will follow up with the next steps.
          </p>
        </section>
      ) : declined ? (
        <section className="proposal-declined" aria-label="Declined">
          <h2>This proposal was declined</h2>
          <p>Contact {issuer} if you would like to revisit the scope or pricing.</p>
        </section>
      ) : (
        <AcceptForm proposalId={proposal.id} token={token} />
      )}

      <footer className="proposal-foot">
        <span>{issuer}</span>
        <span>Proposal {proposal.id.slice(0, 8).toUpperCase()} · {money(proposal.totalMinor, proposal.currency)}</span>
      </footer>
    </main>
  );
}
