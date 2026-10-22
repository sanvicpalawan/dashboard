import { requireUser } from "@/lib/auth";
import { ResourceModule } from "@/components/resource-module";
export const dynamic = "force-dynamic";
export const metadata = { title: "Clients" };
export default async function ClientsPage() { const user = await requireUser("clients.view"); return <ResourceModule resource="clients" user={user} />; }
