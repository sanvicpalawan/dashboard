import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { widgetDefinitions, widgetInstances } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getAccessibleDashboard } from "@/lib/dashboards";

export const dynamic = "force-dynamic";
const schema = z.object({ definitionKey: z.string().min(1).max(100), settings: z.record(z.string(), z.unknown()).default({}) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await apiUser("dashboards.manage");
  if (response) return response;
  const dashboardId = (await params).id;
  const dashboard = await getAccessibleDashboard(user, dashboardId);
  if (!dashboard) return Response.json({ error: "Dashboard not found." }, { status: 404 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Select a valid widget definition." }, { status: 400 });
  const [definition] = await db.select().from(widgetDefinitions).where(and(eq(widgetDefinitions.key, parsed.data.definitionKey), eq(widgetDefinitions.installed, true), eq(widgetDefinitions.enabled, true))).limit(1);
  if (!definition) return Response.json({ error: "Widget is disabled, uninstalled or not registered." }, { status: 400 });
  if (definition.allowedRoles.length && !definition.allowedRoles.includes(user.roleSlug)) return Response.json({ error: "Your role cannot install this widget." }, { status: 403 });
  const current = await db.select().from(widgetInstances).where(eq(widgetInstances.dashboardId, dashboardId));
  if (current.length >= 100) return Response.json({ error: "This dashboard reached the practical limit of 100 widgets." }, { status: 400 });
  const [widget] = await db.insert(widgetInstances).values({ dashboardId, definitionKey: definition.key, title: definition.name, description: definition.description, width: definition.defaultWidth, height: definition.defaultHeight, x: 0, y: current.reduce((max, item) => Math.max(max, item.y + item.height), 0), position: current.length, refreshInterval: definition.refreshInterval, settings: { ...(definition.defaults as Record<string, unknown>), ...parsed.data.settings } }).returning();
  await audit(user, "widget.added", "dashboard", dashboardId, { widget: definition.key, instanceId: widget.id });
  return Response.json({ widget }, { status: 201 });
}
