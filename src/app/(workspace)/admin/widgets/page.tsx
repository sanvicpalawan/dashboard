import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { dashboards, roles, widgetDefinitions } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { WidgetManager } from "@/components/widget-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "Widget registry" };
export default async function WidgetsPage() { const user = await requireUser("dashboards.manage"); const [definitions, dashboardRows, roleRows] = await Promise.all([db.select().from(widgetDefinitions).orderBy(asc(widgetDefinitions.category), asc(widgetDefinitions.name)), db.select().from(dashboards).where(eq(dashboards.workspaceId, user.workspaceId)), db.select().from(roles).orderBy(roles.name)]); return <WidgetManager initialDefinitions={definitions} dashboards={dashboardRows} roles={roleRows} />; }
