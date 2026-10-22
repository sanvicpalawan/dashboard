import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  dashboardAssignments,
  dashboards,
  userDashboardLayouts,
  userPreferences,
  widgetDefinitions,
  widgetInstances,
  type DashboardRecord,
  type WidgetInstanceRecord,
} from "@/db/schema";
import { hasPermission, type SessionUser } from "@/lib/permissions";

export type LayoutOverride = {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  position?: number;
  visible?: boolean;
  title?: string;
  settings?: Record<string, unknown>;
};

export async function listAccessibleDashboards(user: SessionUser) {
  const [records, assignments] = await Promise.all([
    db.select().from(dashboards).where(eq(dashboards.workspaceId, user.workspaceId)).orderBy(asc(dashboards.createdAt)),
    db.select().from(dashboardAssignments),
  ]);
  const manage = hasPermission(user, "dashboards.manage");
  return records.filter((dashboard) => {
    if (manage) return true;
    if (dashboard.status !== "published") return dashboard.ownerId === user.id;
    if (dashboard.ownerId === user.id || dashboard.audience === "agency") return true;
    if (dashboard.teamId && dashboard.teamId === user.teamId) return true;
    return assignments.some((assignment) => assignment.dashboardId === dashboard.id && (
      (assignment.subjectType === "user" && assignment.subjectId === user.id) ||
      (assignment.subjectType === "role" && assignment.subjectId === user.roleId) ||
      (assignment.subjectType === "team" && assignment.subjectId === user.teamId)
    ));
  });
}

export async function getAccessibleDashboard(user: SessionUser, id?: string) {
  const available = await listAccessibleDashboards(user);
  if (id) return available.find((dashboard) => dashboard.id === id) ?? null;
  const [preference] = await db.select().from(userPreferences).where(eq(userPreferences.userId, user.id)).limit(1);
  const assignments = await db.select().from(dashboardAssignments);
  const assignedDefault = assignments.find((assignment) => assignment.isDefault && ((assignment.subjectType === "user" && assignment.subjectId === user.id) || (assignment.subjectType === "role" && assignment.subjectId === user.roleId) || (assignment.subjectType === "team" && assignment.subjectId === user.teamId)));
  return available.find((dashboard) => dashboard.id === preference?.defaultDashboardId) ?? available.find((dashboard) => dashboard.id === assignedDefault?.dashboardId) ?? available.find((dashboard) => dashboard.isDefault && dashboard.status === "published") ?? available[0] ?? null;
}

export async function getDashboardWidgets(user: SessionUser, dashboard: DashboardRecord, personal = true) {
  const instances = await db.select().from(widgetInstances)
    .innerJoin(widgetDefinitions, eq(widgetDefinitions.key, widgetInstances.definitionKey))
    .where(and(eq(widgetInstances.dashboardId, dashboard.id), eq(widgetDefinitions.installed, true), eq(widgetDefinitions.enabled, true)))
    .orderBy(asc(widgetInstances.position));
  let records = instances.map((row) => row.widget_instances);
  const canManage = hasPermission(user, "dashboards.manage");
  if (personal && !canManage) {
    const [override] = await db.select().from(userDashboardLayouts)
      .where(and(eq(userDashboardLayouts.userId, user.id), eq(userDashboardLayouts.dashboardId, dashboard.id))).limit(1);
    const layout = (override?.layout ?? []) as LayoutOverride[];
    if (layout.length) {
      records = records.map((record) => {
        const item = layout.find((entry) => entry.id === record.id);
        if (!item) return record;
        return {
          ...record,
          x: item.x ?? record.x,
          y: item.y ?? record.y,
          width: item.width ?? record.width,
          height: item.height ?? record.height,
          position: item.position ?? record.position,
          visible: item.visible ?? record.visible,
          title: record.userConfigurable && item.title ? item.title.slice(0, 120) : record.title,
          settings: record.userConfigurable && item.settings ? item.settings : record.settings,
        };
      }).sort((a, b) => a.position - b.position);
    }
  }
  return records;
}

export async function snapshotDashboard(dashboard: DashboardRecord) {
  const widgets = await db.select().from(widgetInstances).where(eq(widgetInstances.dashboardId, dashboard.id)).orderBy(asc(widgetInstances.position));
  return {
    dashboard: {
      name: dashboard.name,
      description: dashboard.description,
      audience: dashboard.audience,
      status: dashboard.status,
      allowCustomization: dashboard.allowCustomization,
      teamId: dashboard.teamId,
    },
    widgets: widgets.map((widget: WidgetInstanceRecord) => ({
      definitionKey: widget.definitionKey,
      title: widget.title,
      description: widget.description,
      x: widget.x,
      y: widget.y,
      width: widget.width,
      height: widget.height,
      position: widget.position,
      refreshInterval: widget.refreshInterval,
      visible: widget.visible,
      enabled: widget.enabled,
      userConfigurable: widget.userConfigurable,
      settings: widget.settings,
    })),
  };
}
