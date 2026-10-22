import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { dashboardVersions, dashboards, userDashboardLayouts, widgetInstances } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getAccessibleDashboard, snapshotDashboard } from "@/lib/dashboards";
import { slugify } from "@/lib/utils";

export const dynamic = "force-dynamic";
const actionSchema = z.object({ action: z.enum(["publish", "duplicate", "rollback"]), version: z.number().int().positive().optional(), confirmation: z.string().optional() });
const snapshotSchema = z.object({
  dashboard: z.object({ name: z.string().min(2).max(100), description: z.string().max(500), audience: z.string(), status: z.string(), allowCustomization: z.boolean(), teamId: z.string().uuid().nullable().optional() }),
  widgets: z.array(z.object({ definitionKey: z.string(), title: z.string(), description: z.string(), x: z.number().int(), y: z.number().int(), width: z.number().int(), height: z.number().int(), position: z.number().int(), refreshInterval: z.number().int(), visible: z.boolean(), enabled: z.boolean(), userConfigurable: z.boolean(), settings: z.record(z.string(), z.unknown()) })).max(100),
});

async function restoreVersion(user: Parameters<typeof getAccessibleDashboard>[0], dashboardId: string, version: number) {
  const [stored] = await db.select().from(dashboardVersions).where(eq(dashboardVersions.dashboardId, dashboardId));
  const all = await db.select().from(dashboardVersions).where(eq(dashboardVersions.dashboardId, dashboardId));
  const target = all.find((item) => item.version === version) ?? (stored?.version === version ? stored : null);
  if (!target) throw new Error("The requested dashboard version does not exist.");
  const snapshot = snapshotSchema.parse(target.snapshot);
  const current = await getAccessibleDashboard(user, dashboardId);
  if (!current) throw new Error("Dashboard not found.");
  await db.transaction(async (tx) => {
    await tx.delete(widgetInstances).where(eq(widgetInstances.dashboardId, dashboardId));
    if (snapshot.widgets.length) await tx.insert(widgetInstances).values(snapshot.widgets.map((widget) => ({ ...widget, dashboardId })));
    await tx.update(dashboards).set({ name: snapshot.dashboard.name, description: snapshot.dashboard.description, audience: snapshot.dashboard.audience, allowCustomization: snapshot.dashboard.allowCustomization, status: "draft", version: current.version + 1, updatedAt: new Date() }).where(eq(dashboards.id, dashboardId));
    await tx.delete(userDashboardLayouts).where(eq(userDashboardLayouts.dashboardId, dashboardId));
  });
  const updated = await getAccessibleDashboard(user, dashboardId);
  if (updated) await db.insert(dashboardVersions).values({ dashboardId, version: updated.version, snapshot: await snapshotDashboard(updated), note: `Rollback from version ${version}`, createdBy: user.id }).onConflictDoNothing();
  await audit(user, "dashboard.rolled_back", "dashboard", dashboardId, { fromVersion: version });
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await apiUser("dashboards.manage");
  if (response) return response;
  const dashboard = await getAccessibleDashboard(user, (await params).id);
  if (!dashboard) return Response.json({ error: "Dashboard not found." }, { status: 404 });
  const versions = await db.select({ version: dashboardVersions.version, note: dashboardVersions.note, createdAt: dashboardVersions.createdAt }).from(dashboardVersions).where(eq(dashboardVersions.dashboardId, dashboard.id));
  return Response.json({ schema: "merqato.dashboard/v1", exportedAt: new Date().toISOString(), configuration: await snapshotDashboard(dashboard), versions });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await apiUser("dashboards.manage");
  if (response) return response;
  const dashboard = await getAccessibleDashboard(user, (await params).id);
  if (!dashboard) return Response.json({ error: "Dashboard not found." }, { status: 404 });
  const parsed = actionSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid dashboard action." }, { status: 400 });
  try {
    if (parsed.data.action === "publish") {
      const nextVersion = dashboard.version + 1;
      const [updated] = await db.update(dashboards).set({ status: "published", publishedAt: new Date(), version: nextVersion, updatedAt: new Date() }).where(eq(dashboards.id, dashboard.id)).returning();
      await db.insert(dashboardVersions).values({ dashboardId: dashboard.id, version: nextVersion, snapshot: await snapshotDashboard(updated), note: "Published configuration", createdBy: user.id });
      await audit(user, "dashboard.published", "dashboard", dashboard.id, { version: nextVersion });
      return Response.json({ dashboard: updated });
    }
    if (parsed.data.action === "duplicate") {
      const snapshot = snapshotSchema.parse(await snapshotDashboard(dashboard));
      const [copy] = await db.insert(dashboards).values({ workspaceId: user.workspaceId, ownerId: user.id, teamId: dashboard.teamId, name: `${dashboard.name} copy`, slug: `${slugify(dashboard.name)}-copy-${Date.now().toString(36).slice(-4)}`, description: dashboard.description, audience: dashboard.audience, status: "draft", allowCustomization: dashboard.allowCustomization }).returning();
      if (snapshot.widgets.length) await db.insert(widgetInstances).values(snapshot.widgets.map((widget) => ({ ...widget, dashboardId: copy.id })));
      await db.insert(dashboardVersions).values({ dashboardId: copy.id, version: 1, snapshot: await snapshotDashboard(copy), note: `Duplicated from ${dashboard.name}`, createdBy: user.id });
      await audit(user, "dashboard.duplicated", "dashboard", dashboard.id, { newDashboardId: copy.id });
      return Response.json({ dashboard: copy }, { status: 201 });
    }
    if (!parsed.data.version) return Response.json({ error: "Select a version to restore." }, { status: 400 });
    if (parsed.data.confirmation !== "ROLLBACK") return Response.json({ error: "Type ROLLBACK to confirm replacing the current draft." }, { status: 400 });
    await restoreVersion(user, dashboard.id, parsed.data.version);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Dashboard action failed." }, { status: 400 });
  }
}
