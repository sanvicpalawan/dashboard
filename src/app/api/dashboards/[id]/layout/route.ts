import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { appSettings, userDashboardLayouts, widgetInstances } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getAccessibleDashboard } from "@/lib/dashboards";
import { hasPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";
const schema = z.object({ widgets: z.array(z.object({ id: z.string().uuid(), x: z.number().int().min(0).max(11), y: z.number().int().min(0).max(1000), width: z.number().int().min(1).max(12), height: z.number().int().min(1).max(12), position: z.number().int().min(0).max(1000), visible: z.boolean(), title: z.string().max(120).optional(), settings: z.record(z.string(), z.unknown()).optional() })).max(200) });

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await apiUser("customize.own");
  if (response) return response;
  const dashboardId = (await params).id;
  const dashboard = await getAccessibleDashboard(user, dashboardId);
  if (!dashboard) return Response.json({ error: "Dashboard not found or access denied." }, { status: 404 });
  await db.delete(userDashboardLayouts).where(and(eq(userDashboardLayouts.userId, user.id), eq(userDashboardLayouts.dashboardId, dashboardId)));
  await audit(user, "dashboard.personal_layout_reset", "dashboard", dashboardId);
  return Response.json({ ok: true });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await apiUser("dashboards.view");
  if (response) return response;
  const dashboardId = (await params).id;
  const dashboard = await getAccessibleDashboard(user, dashboardId);
  if (!dashboard) return Response.json({ error: "Dashboard not found or access denied." }, { status: 404 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Layout validation failed." }, { status: 400 });
  const ids = parsed.data.widgets.map((widget) => widget.id);
  const existing = ids.length ? await db.select().from(widgetInstances).where(and(eq(widgetInstances.dashboardId, dashboardId), inArray(widgetInstances.id, ids))) : [];
  if (existing.length !== new Set(ids).size) return Response.json({ error: "Layout contains widgets outside this dashboard." }, { status: 400 });
  const manage = hasPermission(user, "dashboards.manage");
  if (manage) {
    await db.transaction(async (tx) => {
      for (const widget of parsed.data.widgets) {
        await tx.update(widgetInstances).set({ x: widget.x, y: widget.y, width: widget.width, height: widget.height, position: widget.position, visible: widget.visible, updatedAt: new Date() }).where(eq(widgetInstances.id, widget.id));
      }
    });
  } else {
    const [workspaceSetting] = await db.select().from(appSettings).where(eq(appSettings.key, `workspace:${user.workspaceId}`)).limit(1);
    const workspacePolicy = workspaceSetting?.value as { allowUserLayouts?: boolean } | undefined;
    if (workspacePolicy?.allowUserLayouts === false || !dashboard.allowCustomization || !hasPermission(user, "customize.own")) return Response.json({ error: "Personal layout customization is disabled for this dashboard, workspace or role." }, { status: 403 });
    if (existing.some((widget) => !widget.userConfigurable)) return Response.json({ error: "One or more widgets are locked by the administrator." }, { status: 403 });
    const layout = parsed.data.widgets.map((widget) => {
      const current = existing.find((item) => item.id === widget.id);
      return { ...widget, title: current?.userConfigurable ? widget.title : current?.title, settings: current?.userConfigurable ? widget.settings : current?.settings };
    });
    await db.insert(userDashboardLayouts).values({ userId: user.id, dashboardId, layout, updatedAt: new Date() }).onConflictDoUpdate({ target: [userDashboardLayouts.userId, userDashboardLayouts.dashboardId], set: { layout, updatedAt: new Date() } });
  }
  await audit(user, manage ? "dashboard.layout_updated" : "dashboard.personal_layout_updated", "dashboard", dashboardId, { widgets: parsed.data.widgets.length });
  return Response.json({ ok: true, scope: manage ? "shared" : "personal" });
}
