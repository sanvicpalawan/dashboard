import { and, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { appSettings, themes } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
export async function PATCH(request: Request) {
  const { user, response } = await apiUser("appearance.manage");
  if (response) return response;
  const parsed = z.object({ defaultThemeId: z.string().uuid() }).safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid default theme." }, { status: 400 });
  const [theme] = await db.select().from(themes).where(and(eq(themes.id, parsed.data.defaultThemeId), or(isNull(themes.workspaceId), eq(themes.workspaceId, user.workspaceId)))).limit(1);
  if (!theme) return Response.json({ error: "Theme not found." }, { status: 404 });
  const key = `workspace:${user.workspaceId}`;
  const [setting] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  const value = { ...(setting?.value as Record<string, unknown> || {}), defaultThemeId: theme.id };
  await db.insert(appSettings).values({ key, value, updatedBy: user.id }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: user.id, updatedAt: new Date() } });
  await audit(user, "appearance.default_theme_updated", "theme", theme.id, { name: theme.name });
  return Response.json({ ok: true });
}
