import Link from "next/link";
import { Bot, ExternalLink, ListChecks, MessageCircle, Plus, Receipt } from "lucide-react";
import { getAccessibleDashboard, getDashboardWidgets, listAccessibleDashboards } from "@/lib/dashboards";
import { requireUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { DashboardGrid } from "@/components/dashboard-grid";
import type { DashboardDTO } from "@/components/widget-types";

const LIBRECHAT_URL = process.env.NEXT_PUBLIC_LIBRECHAT_URL || "http://localhost:3080";
const OPENLIVERY_URL = process.env.NEXT_PUBLIC_OPENLIVERY_URL || "http://localhost:3000";
const INVOICESHELF_URL = process.env.NEXT_PUBLIC_INVOICESHELF_URL || "http://localhost:8090";

export const dynamic = "force-dynamic";

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ dashboard?: string; denied?: string }> }) {
  const user = await requireUser("dashboards.view");
  const params = await searchParams;
  const [available, dashboard] = await Promise.all([listAccessibleDashboards(user), getAccessibleDashboard(user, params.dashboard)]);
  const serialize = (item: NonNullable<typeof dashboard>): DashboardDTO => ({ id: item.id, name: item.name, slug: item.slug, description: item.description, audience: item.audience, status: item.status, isDefault: item.isDefault, allowCustomization: item.allowCustomization, version: item.version, teamId: item.teamId, ownerId: item.ownerId, updatedAt: item.updatedAt.toISOString() });
  if (!dashboard) return <><div className="page-heading"><div><div className="eyebrow">Agency operating system</div><h1>No dashboard available</h1><p className="page-description">Your account does not have an assigned dashboard yet.</p></div></div><div className="card empty-state" style={{ minHeight: 320 }}><strong>Start with a purpose-built operating view</strong><p>{hasPermission(user, "dashboards.manage") ? "Create a dashboard, add widgets from the registry, then publish it to your team." : "Ask an administrator to publish or assign a dashboard to your user, team or role."}</p>{hasPermission(user, "dashboards.manage") && <Link className="button button-primary" href="/admin/dashboards" style={{ marginTop: 14 }}><Plus size={14} />Create dashboard</Link>}</div></>;
  const widgets = await getDashboardWidgets(user, dashboard);
  return <>{params.denied && <div className="notice notice-warning">Your role does not permit the requested administrative area. This restriction is also enforced by the backend.</div>}<section className="quick-launch-bar" aria-label="Quick launch"><div className="quick-launch-inner"><span className="quick-launch-label">Quick launch</span><div className="quick-launch-buttons"><a className="button" href={LIBRECHAT_URL} target="_blank" rel="noopener noreferrer" title="Open LibreChat"><MessageCircle size={15} />LibreChat</a><a className="button" href={OPENLIVERY_URL} target="_blank" rel="noopener noreferrer" title="Open OpenLivery"><Bot size={15} />OpenLivery</a><Link className="button" href="/agent" title="Open Agent Jobs"><ListChecks size={15} />Agent jobs</Link><a className="button" href={INVOICESHELF_URL} target="_blank" rel="noopener noreferrer" title="Open InvoiceShelf"><Receipt size={15} />InvoiceShelf</a></div></div></section><DashboardGrid dashboard={serialize(dashboard)} dashboards={available.map(serialize)} user={user} initialWidgets={widgets.map((widget) => ({ id: widget.id, dashboardId: widget.dashboardId, definitionKey: widget.definitionKey, title: widget.title, description: widget.description, x: widget.x, y: widget.y, width: widget.width, height: widget.height, position: widget.position, refreshInterval: widget.refreshInterval, visible: widget.visible, enabled: widget.enabled, userConfigurable: widget.userConfigurable, settings: widget.settings }))} /></>;
}
