import Link from "next/link";
import { Activity, Blocks, LayoutDashboard, LayoutGrid, Palette, Settings2, ShieldCheck, Users } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { AdminNav } from "@/components/admin-nav";

export const dynamic = "force-dynamic";
const items = [
  { href: "/admin", label: "Overview", icon: Activity, permission: "admin.access" },
  { href: "/admin/dashboards", label: "Dashboards", icon: LayoutDashboard, permission: "dashboards.manage" },
  { href: "/admin/widgets", label: "Widget registry", icon: LayoutGrid, permission: "dashboards.manage" },
  { href: "/admin/users", label: "Users & teams", icon: Users, permission: "users.manage" },
  { href: "/admin/integrations", label: "Integrations", icon: Blocks, permission: "integrations.view" },
  { href: "/admin/appearance", label: "Appearance", icon: Palette, permission: "appearance.manage" },
  { href: "/admin/settings", label: "Global settings", icon: Settings2, permission: "settings.manage" },
  { href: "/admin/audit", label: "Security & audit", icon: ShieldCheck, permission: "audit.view" },
];
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("admin.access");
  return <div className="admin-layout"><aside className="card admin-nav"><div className="nav-section">Control plane</div>{items.filter((item) => hasPermission(user, item.permission)).map((item) => <AdminNavItem key={item.href} href={item.href} label={item.label} icon={item.icon} />)}</aside><div className="admin-content">{children}</div></div>;
}
function AdminNavItem({ href, label, icon: Icon }: { href: string; label: string; icon: typeof Activity }) { return <AdminNav href={href} label={label} icon={<Icon size={14} />} />; }
