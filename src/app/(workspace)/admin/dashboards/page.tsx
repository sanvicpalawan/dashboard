import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { dashboardAssignments, dashboardVersions, dashboards, roles, teams, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getAccessibleDashboard, getDashboardWidgets } from "@/lib/dashboards";
import { DashboardManager } from "@/components/dashboard-manager";
import { DashboardGrid } from "@/components/dashboard-grid";
export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard builder" };
export default async function DashboardBuilderPage({ searchParams }: { searchParams: Promise<{ selected?: string }> }) {
  const user = await requireUser("dashboards.manage");
  const { selected } = await searchParams;
  const [dashboardRows, userRows, teamRows, roleRows] = await Promise.all([db.select().from(dashboards).where(eq(dashboards.workspaceId, user.workspaceId)).orderBy(desc(dashboards.updatedAt)), db.select({ id: users.id, name: users.name }).from(users).where(eq(users.workspaceId, user.workspaceId)), db.select().from(teams).where(eq(teams.workspaceId, user.workspaceId)), db.select().from(roles)]);
  const dashboard = await getAccessibleDashboard(user, selected || dashboardRows[0]?.id);
  const [widgets, versions, assignments] = dashboard ? await Promise.all([getDashboardWidgets(user, dashboard, false), db.select().from(dashboardVersions).where(eq(dashboardVersions.dashboardId, dashboard.id)).orderBy(desc(dashboardVersions.version)), db.select().from(dashboardAssignments).where(eq(dashboardAssignments.dashboardId, dashboard.id))]) : [[], [], []];
  const serialize = (item: any) => ({ id: item.id, name: item.name, slug: item.slug, description: item.description, audience: item.audience, status: item.status, isDefault: item.isDefault, allowCustomization: item.allowCustomization, version: item.version, teamId: item.teamId, ownerId: item.ownerId, updatedAt: item.updatedAt.toISOString() });
  return <><DashboardManager dashboards={dashboardRows.map((item) => ({ ...item, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString(), publishedAt: item.publishedAt?.toISOString() || null }))} selectedId={dashboard?.id} users={userRows} teams={teamRows} roles={roleRows} versions={versions} assignments={assignments} />{dashboard && <div id="visual-builder" style={{ borderTop: "1px solid var(--border)", paddingTop: 24 }}><div className="eyebrow">Live visual editor · changes save to shared draft</div><DashboardGrid dashboard={serialize(dashboard)} dashboards={dashboardRows.map(serialize)} user={user} initialWidgets={(widgets as any[]).map((widget) => ({ id: widget.id, dashboardId: widget.dashboardId, definitionKey: widget.definitionKey, title: widget.title, description: widget.description, x: widget.x, y: widget.y, width: widget.width, height: widget.height, position: widget.position, refreshInterval: widget.refreshInterval, visible: widget.visible, enabled: widget.enabled, userConfigurable: widget.userConfigurable, settings: widget.settings }))} /></div>}</>;
}
