import { z } from "zod";
import { apiUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { widgetByKey } from "@/lib/widget-registry";
import { getWidgetData } from "@/lib/widget-data";
import { checkRateLimit } from "@/lib/security";
import { db } from "@/db";
import { widgetDefinitions } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
const schema = z.object({ key: z.string().min(1).max(100), settings: z.record(z.string(), z.unknown()).default({}) });

export async function POST(request: Request) {
  const { user, response } = await apiUser();
  if (response) return response;
  const rate = checkRateLimit(`widget:${user.id}`, 240, 60_000);
  if (!rate.allowed) return Response.json({ error: "Widget request rate limit reached." }, { status: 429 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid widget data request." }, { status: 400 });
  const definition = widgetByKey(parsed.data.key);
  if (!definition) return Response.json({ error: "Widget is not registered." }, { status: 404 });
  const [policy] = await db.select().from(widgetDefinitions).where(eq(widgetDefinitions.key, definition.key)).limit(1);
  if (!policy?.installed || !policy.enabled) return Response.json({ error: "Widget is disabled or uninstalled." }, { status: 403 });
  if (policy.allowedRoles.length && !policy.allowedRoles.includes(user.roleSlug) && !user.permissions.includes("*")) return Response.json({ error: "Your role is not allowed to use this widget." }, { status: 403 });
  if (!definition.permissions.every((permission) => hasPermission(user, permission))) {
    return Response.json({ error: "Your role cannot read this widget's data." }, { status: 403 });
  }
  try {
    const data = await getWidgetData(definition.key, user, parsed.data.settings);
    return Response.json({ data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ data: { kind: "state", state: "error", message: "This widget could not load its data. No records were changed; try refreshing or inspect administration health." } }, { status: 200 });
  }
}
