import { requireUser } from "@/lib/auth";
import { SystemMonitor } from "@/components/system-monitor";
import { systemSnapshot } from "@/lib/system";

export const dynamic = "force-dynamic";
export const metadata = { title: "Server" };

export default async function SystemPage() {
  const user = await requireUser("operations.view");
  const initial = await systemSnapshot(user.workspaceId);
  return <SystemMonitor initial={initial} />;
}
