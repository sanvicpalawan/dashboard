import { requireUser } from "@/lib/auth";
import { ClientDetail } from "@/components/client-detail";
export const dynamic = "force-dynamic";
export const metadata = { title: "Client" };
export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) { await requireUser("clients.view"); const { id } = await params; return <ClientDetail clientId={id} />; }
