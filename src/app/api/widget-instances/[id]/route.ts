import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { dashboards, widgetInstances } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getAccessibleDashboard } from "@/lib/dashboards";

export const dynamic = "force-dynamic";
const patchSchema = z.object({ title: z.string().trim().min(1).max(120).optional(), description: z.string().max(500).optional(), refreshInterval: z.number().int().min(30).max(86400).optional(), visible: z.boolean().optional(), enabled: z.boolean().optional(), userConfigurable: z.boolean().optional(), settings: z.record(z.string(), z.unknown()).optional(), width: z.number().int().min(1).max(12).optional(), height: z.number().int().min(1).max(12).optional() });

async function context(user: Parameters<typeof getAccessibleDashboard>[0], id: string) {
  const [row] = await db.select({ widget: widgetInstances, dashboard: dashboards }).from(widgetInstances).innerJoin(dashboards, eq(dashboards.id, widgetInstances.dashboardId)).where(eq(widgetInstances.id, id)).limit(1);
  if (!row) return null;
  const accessible = await getAccessibleDashboard(user, row.dashboard.id);
  return accessible ? row : null;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await apiUser("dashboards.manage");
  if (response) return response;
  const id = (await params).id;
  const found = await context(user, id);
  if (!found) return Response.json({ error: "Widget not found." }, { status: 404 });
  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid widget settings." }, { status: 400 });
  const [widget] = await db.update(widgetInstances).set({ ...parsed.data, updatedAt: new Date() }).where(eq(widgetInstances.id, id)).returning();
  await audit(user, "widget.configured", "widget", id, { dashboardId: found.dashboard.id, fields: Object.keys(parsed.data) });
  return Response.json({ widget });
}

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await apiUser("dashboards.manage");
  if (response) return response;
  const id = (await params).id;
  const found = await context(user, id);
  if (!found) return Response.json({ error: "Widget not found." }, { status: 404 });
  const siblings = await db.select().from(widgetInstances).where(eq(widgetInstances.dashboardId, found.dashboard.id));
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...copy } = found.widget;
  const [widget] = await db.insert(widgetInstances).values({ ...copy, title: `${found.widget.title} copy`, position: siblings.length, y: siblings.reduce((max, item) => Math.max(max, item.y + item.height), 0) }).returning();
  await audit(user, "widget.duplicated", "widget", id, { newInstanceId: widget.id, dashboardId: found.dashboard.id });
  return Response.json({ widget }, { status: 201 });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await apiUser("dashboards.manage");
  if (response) return response;
  const id = (await params).id;
  const found = await context(user, id);
  if (!found) return Response.json({ error: "Widget not found." }, { status: 404 });
  const body = await request.json().catch(() => ({})) as { confirm?: boolean };
  if (!body.confirm) return Response.json({ error: "Explicit confirmation is required." }, { status: 400 });
  await db.delete(widgetInstances).where(eq(widgetInstances.id, id));
  await audit(user, "widget.removed", "widget", id, { dashboardId: found.dashboard.id, definition: found.widget.definitionKey });
  return Response.json({ ok: true });
}
