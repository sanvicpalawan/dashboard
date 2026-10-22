import { requireUser } from "@/lib/auth";
import { OperationsModule } from "@/components/operations-module";
export const dynamic = "force-dynamic";
export const metadata = { title: "Operations" };
export default async function OperationsPage() { const user = await requireUser("operations.view"); return <OperationsModule user={user} />; }
