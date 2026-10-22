import { z } from "zod";
import { db } from "@/db";
import { dashboardVersions, dashboards, widgetDefinitions, widgetInstances } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { snapshotDashboard } from "@/lib/dashboards";
import { slugify } from "@/lib/utils";
import { inArray } from "drizzle-orm";

const widgetSchema = z.object({ definitionKey: z.string().max(100), title: z.string().min(1).max(120), description: z.string().max(500).default(""), x: z.number().int().min(0).max(11).default(0), y: z.number().int().min(0).max(1000).default(0), width: z.number().int().min(1).max(12), height: z.number().int().min(1).max(12), position: z.number().int().min(0).max(100), refreshInterval: z.number().int().min(30).max(86400), visible: z.boolean().default(true), enabled: z.boolean().default(true), userConfigurable: z.boolean().default(true), settings: z.record(z.string(), z.unknown()).default({}) });
const schema = z.object({ schema: z.literal("merqato.dashboard/v1"), configuration: z.object({ dashboard: z.object({ name: z.string().min(2).max(100), description: z.string().max(500).default(""), audience: z.enum(["agency", "team", "individual", "client", "function"]).default("agency"), allowCustomization: z.boolean().default(true), teamId: z.string().uuid().nullable().optional() }), widgets: z.array(widgetSchema).max(100) }) });

export async function POST(request: Request) {
  const { user, response } = await apiUser("dashboards.manage");
  if (response) return response;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid MerQato dashboard JSON. Expected schema merqato.dashboard/v1 and a validated widget layout." }, { status: 400 });
  const keys = [...new Set(parsed.data.configuration.widgets.map((widget) => widget.definitionKey))];
  const installed = keys.length ? await db.select().from(widgetDefinitions).where(inArray(widgetDefinitions.key, keys)) : [];
  const unavailable = keys.filter((key) => !installed.some((item) => item.key === key && item.installed));
  if (unavailable.length) return Response.json({ error: `Import contains uninstalled widget definitions: ${unavailable.join(", ")}.` }, { status: 400 });
  const config = parsed.data.configuration;
  const [dashboard] = await db.insert(dashboards).values({ workspaceId: user.workspaceId, ownerId: user.id, name: config.dashboard.name, slug: `${slugify(config.dashboard.name)}-${Date.now().toString(36).slice(-4)}`, description: config.dashboard.description, audience: config.dashboard.audience, teamId: config.dashboard.teamId, allowCustomization: config.dashboard.allowCustomization, status: "draft" }).returning();
  if (config.widgets.length) await db.insert(widgetInstances).values(config.widgets.map((widget) => ({ ...widget, dashboardId: dashboard.id })));
  await db.insert(dashboardVersions).values({ dashboardId: dashboard.id, version: 1, snapshot: await snapshotDashboard(dashboard), note: "Validated JSON import", createdBy: user.id });
  await audit(user, "dashboard.imported", "dashboard", dashboard.id, { widgets: config.widgets.length });
  return Response.json({ dashboard }, { status: 201 });
}
