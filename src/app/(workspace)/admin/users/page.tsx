import { requireUser } from "@/lib/auth";
import { UserManager } from "@/components/user-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "Users & teams" };
export default async function UsersPage() { await requireUser("users.manage"); return <UserManager />; }
