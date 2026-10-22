import { requireUser } from "@/lib/auth";
import { ResourceModule } from "@/components/resource-module";
export const dynamic = "force-dynamic";
export const metadata = { title: "Websites" };
export default async function WebsitesPage() { const user = await requireUser("websites.view"); return <ResourceModule resource="websites" user={user} />; }
