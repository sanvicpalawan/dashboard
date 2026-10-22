import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { ensureBootstrap } from "@/db/bootstrap";
import { appSettings, notifications, themes, userPreferences } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { AppShell } from "@/components/app-shell";
import { THEME_PRESETS, type ThemePreset } from "@/lib/themes";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  await ensureBootstrap();
  const user = await requireUser();
  const [preference, notificationRows, setting] = await Promise.all([
    db.select().from(userPreferences).where(eq(userPreferences.userId, user.id)).limit(1).then((rows) => rows[0]),
    db.select().from(notifications).where(eq(notifications.userId, user.id)).orderBy(desc(notifications.createdAt)).limit(30),
    db.select().from(appSettings).where(eq(appSettings.key, `workspace:${user.workspaceId}`)).limit(1).then((rows) => rows[0]),
  ]);
  const workspaceConfig = setting?.value as any;
  const selectedThemeId = preference?.themeId ?? workspaceConfig?.defaultThemeId;
  const themeRow = selectedThemeId ? (await db.select().from(themes).where(eq(themes.id, selectedThemeId)).limit(1))[0] : (await db.select().from(themes).where(eq(themes.isDefault, true)).limit(1))[0];
  const fallback = THEME_PRESETS.find((item) => item.slug === themeRow?.slug) ?? THEME_PRESETS[0];
  const theme: ThemePreset = themeRow ? { name: themeRow.name, slug: themeRow.slug, description: themeRow.description, mode: themeRow.mode as "dark" | "light", colors: themeRow.colors, typography: themeRow.typography, density: themeRow.density as "compact" | "comfortable", cardStyle: themeRow.cardStyle as ThemePreset["cardStyle"], sidebarStyle: themeRow.sidebarStyle as ThemePreset["sidebarStyle"] } : fallback;
  const maintenance = workspaceConfig?.maintenanceMode === true && !hasPermission(user, "settings.manage");
  const content = maintenance ? <div className="card empty-state" style={{ minHeight: 420 }}><strong>Maintenance in progress</strong><p>MerQato Command Center is temporarily unavailable for this account. An administrator can disable maintenance mode after the work is complete.</p></div> : children;
  return <AppShell user={user} theme={theme} accent={preference?.accent} density={preference?.density} mode={preference?.mode} branding={{ applicationName: workspaceConfig?.applicationName, coBrand: workspaceConfig?.coBrand, brandMark: workspaceConfig?.brandMark, logoUrl: workspaceConfig?.logoUrl, faviconUrl: workspaceConfig?.faviconUrl }} navigation={workspaceConfig?.navigation || []} notifications={notificationRows.map((item) => ({ ...item, readAt: item.readAt?.toISOString() ?? null, createdAt: item.createdAt.toISOString() }))}>{content}</AppShell>;
}
