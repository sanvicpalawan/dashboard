import { and, eq, or, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { appSettings, themes, userPreferences } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { getAccessibleDashboard } from "@/lib/dashboards";
import { hasPermission } from "@/lib/permissions";
const schema = z.object({ themeId: z.string().uuid().optional(), accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(), density: z.enum(["compact", "comfortable"]).nullable().optional(), mode: z.enum(["dark", "light"]).nullable().optional(), defaultDashboardId: z.string().uuid().nullable().optional(), notificationSettings: z.record(z.string(), z.boolean()).optional() });
export async function PATCH(request: Request) {
  const { user, response } = await apiUser("appearance.view");
  if (response) return response;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid appearance preference." }, { status: 400 });
  const [setting] = await db.select().from(appSettings).where(eq(appSettings.key, `workspace:${user.workspaceId}`)).limit(1);
  const config = setting?.value as { allowUserThemes?: boolean };
  if (config?.allowUserThemes === false && !hasPermission(user, "appearance.manage")) return Response.json({ error: "Administrators have disabled personal theme changes." }, { status: 403 });
  if (parsed.data.themeId) { const [theme] = await db.select().from(themes).where(and(eq(themes.id, parsed.data.themeId), or(isNull(themes.workspaceId), eq(themes.workspaceId, user.workspaceId)))).limit(1); if (!theme) return Response.json({ error: "Theme is not available in this workspace." }, { status: 404 }); }
  if (parsed.data.defaultDashboardId && !(await getAccessibleDashboard(user, parsed.data.defaultDashboardId))) return Response.json({ error: "Default dashboard is not accessible." }, { status: 403 });
  const [current] = await db.select().from(userPreferences).where(eq(userPreferences.userId, user.id)).limit(1);
  const values = { themeId: parsed.data.themeId === undefined ? current?.themeId : parsed.data.themeId, accent: parsed.data.accent === undefined ? current?.accent : parsed.data.accent, density: parsed.data.density === undefined ? current?.density : parsed.data.density, mode: parsed.data.mode === undefined ? current?.mode : parsed.data.mode, defaultDashboardId: parsed.data.defaultDashboardId === undefined ? current?.defaultDashboardId : parsed.data.defaultDashboardId, notificationSettings: parsed.data.notificationSettings ?? current?.notificationSettings ?? {}, updatedAt: new Date() };
  await db.insert(userPreferences).values({ userId: user.id, ...values }).onConflictDoUpdate({ target: userPreferences.userId, set: values });
  return Response.json({ ok: true });
}
