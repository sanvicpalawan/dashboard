import { requireUser } from "@/lib/auth";
import { ToolDetail } from "@/components/tool-detail";
export const dynamic = "force-dynamic";
export const metadata = { title: "Tool" };
export default async function ToolPage({ params }: { params: Promise<{ id: string }> }) { await requireUser("tools.view"); const { id } = await params; return <ToolDetail toolId={id} />; }
