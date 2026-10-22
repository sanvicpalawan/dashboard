import { requireUser } from "@/lib/auth";
import { IntegrationManager } from "@/components/integration-manager";
import { AgentAccessPanel } from "@/components/agent-access";

export const dynamic = "force-dynamic";
export const metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const user = await requireUser("integrations.view");
  return <>
    <IntegrationManager user={user} />
    <AgentAccessPanel />
  </>;
}
