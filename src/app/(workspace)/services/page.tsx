import { requireUser } from "@/lib/auth";
import { ResourceModule } from "@/components/resource-module";
export const dynamic = "force-dynamic";
export const metadata = { title: "Services & pricing" };
export default async function ServicesPage() { const user = await requireUser("services.view"); return <ResourceModule resource="services" user={user} />; }
