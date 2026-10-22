import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { GlobalSettings } from "@/components/global-settings";
export const dynamic = "force-dynamic";
export const metadata = { title: "Global settings" };
export default async function SettingsPage() { const user = await requireUser("settings.manage"); const [setting] = await db.select().from(appSettings).where(eq(appSettings.key, `workspace:${user.workspaceId}`)).limit(1); return <GlobalSettings initial={setting?.value || {}} demo={user.demoMode} />; }
