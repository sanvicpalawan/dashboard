import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, themes, userPreferences } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { listAccessibleDashboards } from "@/lib/dashboards";
import { hasPermission } from "@/lib/permissions";
import { ThemeGallery } from "@/components/theme-gallery";
export const dynamic = "force-dynamic";
export const metadata = { title: "Appearance" };
export default async function AppearancePage() { const user = await requireUser("appearance.view"); const [themeRows, preference, dashboards, setting] = await Promise.all([db.select().from(themes).where(or(isNull(themes.workspaceId), eq(themes.workspaceId, user.workspaceId))), db.select().from(userPreferences).where(eq(userPreferences.userId, user.id)).limit(1).then((rows) => rows[0]), listAccessibleDashboards(user), db.select().from(appSettings).where(eq(appSettings.key, `workspace:${user.workspaceId}`)).limit(1).then((rows) => rows[0])]); const config = setting?.value as any; return <ThemeGallery themes={themeRows} preference={preference} dashboards={dashboards} admin={hasPermission(user, "appearance.manage")} allowUserThemes={config?.allowUserThemes !== false} defaultThemeId={config?.defaultThemeId} />; }
