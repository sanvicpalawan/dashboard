import { requireUser } from "@/lib/auth";
import { LeadGeneration } from "@/components/lead-generation";
export const dynamic = "force-dynamic";
export const metadata = { title: "Lead generation" };
export default async function LeadsPage() { const user = await requireUser("leads.view"); return <LeadGeneration user={user} />; }
