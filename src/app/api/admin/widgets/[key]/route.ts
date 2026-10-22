import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { roles, widgetDefinitions } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
const schema = z.object({ installed: z.boolean().optional(), enabled: z.boolean().optional(), defaultWidth: z.number().int().min(1).max(12).optional(), defaultHeight: z.number().int().min(1).max(12).optional(), minWidth: z.number().int().min(1).max(12).optional(), minHeight: z.number().int().min(1).max(12).optional(), maxWidth: z.number().int().min(1).max(12).optional(), maxHeight: z.number().int().min(1).max(12).optional(), refreshInterval: z.number().int().min(30).max(86400).optional(), allowedRoles: z.array(z.string()).max(30).optional(), defaults: z.record(z.string(), z.unknown()).optional() });
export async function PATCH(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { user, response } = await apiUser("dashboards.manage");
  if (response) return response;
  const key = (await params).key;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid widget registry settings." }, { status: 400 });
  const [definition] = await db.select().from(widgetDefinitions).where(eq(widgetDefinitions.key, key)).limit(1);
  if (!definition) return Response.json({ error: "Widget definition not found." }, { status: 404 });
  const next = { ...definition, ...parsed.data };
  if (next.minWidth > next.maxWidth || next.minHeight > next.maxHeight || next.defaultWidth < next.minWidth || next.defaultWidth > next.maxWidth || next.defaultHeight < next.minHeight || next.defaultHeight > next.maxHeight) return Response.json({ error: "Default dimensions must be within the configured minimum and maximum." }, { status: 400 });
  if (parsed.data.allowedRoles) { const validRoles = await db.select({ slug: roles.slug }).from(roles); if (parsed.data.allowedRoles.some((slug) => !validRoles.some((role) => role.slug === slug))) return Response.json({ error: "Unknown role in widget policy." }, { status: 400 }); }
  const [updated] = await db.update(widgetDefinitions).set({ ...parsed.data, updatedAt: new Date() }).where(eq(widgetDefinitions.key, key)).returning();
  await audit(user, "widget.registry_updated", "widget_definition", key, { fields: Object.keys(parsed.data), installed: updated.installed, enabled: updated.enabled });
  return Response.json({ definition: updated });
}
