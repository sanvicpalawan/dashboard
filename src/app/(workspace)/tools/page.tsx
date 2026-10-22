import { requireUser } from "@/lib/auth";
import { ToolsCatalog } from "@/components/tools-catalog";
export const dynamic = "force-dynamic";
export const metadata = { title: "Automation tools" };
export default async function ToolsPage() { const user = await requireUser("tools.view"); return <ToolsCatalog user={user} />; }
