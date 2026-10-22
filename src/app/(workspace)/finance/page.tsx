import { requireUser } from "@/lib/auth";
import { ModuleTabs } from "@/components/module-tabs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Finance" };
export default async function FinancePage() { const user = await requireUser("finance.view"); return <ModuleTabs user={user} tabs={["invoices", "subscriptions", "expenses"]} defaultTab="invoices" title="Finance & commercial operations" eyebrow="Revenue with provenance" description="Invoiced revenue, cash received, recurring value and recorded costs stay separate. Connect InvoiceShelf where its installed API version supports synchronization." />; }
