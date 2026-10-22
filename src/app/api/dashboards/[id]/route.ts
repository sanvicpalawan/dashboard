import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { dashboards } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getAccessibleDashboard, getDashboardWidgets } from "@/lib/dashboards";

export const dynamic = "force-dynamic";
const patchSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  description: z.string().max(500).optional(),
  audience: z.enum(["agency", "team", "individual", "client", "function"]).optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
  isDefault: z.boolean().optional(),
  allowCustomization: z.boolean().optional(),
  teamId: z.string().uuid().nullable().optional(),
});

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await apiUser("dashboards.view");
  if (response) return response;
  const dashboard = await getAccessibleDashboard(user, (await params).id);
  if (!dashboard) return Response.json({ error: "Dashboard not found or access denied." }, { status: 404 });
  const widgets = await getDashboardWidgets(user, dashboard);
  return Response.json({ dashboard, widgets });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await apiUser("dashboards.manage");
  if (response) return response;
  const id = (await params).id;
  const dashboard = await getAccessibleDashboard(user, id);
  if (!dashboard) return Response.json({ error: "Dashboard not found." }, { status: 404 });
  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid dashboard configuration." }, { status: 400 });
  if (parsed.data.status === "published") return Response.json({ error: "Use the publish action so a rollback version is recorded." }, { status: 400 });
  if (parsed.data.isDefault) await db.update(dashboards).set({ isDefault: false }).where(and(eq(dashboards.workspaceId, user.workspaceId), ne(dashboards.id, id)));
  const [updated] = await db.update(dashboards).set({ ...parsed.data, updatedAt: new Date() }).where(eq(dashboards.id, id)).returning();
  await audit(user, "dashboard.updated", "dashboard", id, { fields: Object.keys(parsed.data), status: updated.status });
  return Response.json({ dashboard: updated });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await apiUser("dashboards.manage");
  if (response) return response;
  const id = (await params).id;
  const dashboard = await getAccessibleDashboard(user, id);
  if (!dashboard) return Response.json({ error: "Dashboard not found." }, { status: 404 });
  const body = await request.json().catch(() => ({})) as { confirmation?: string };
  if (body.confirmation !== dashboard.name) return Response.json({ error: "Type the exact dashboard name to confirm deletion." }, { status: 400 });
  await db.delete(dashboards).where(eq(dashboards.id, id));
  await audit(user, "dashboard.deleted", "dashboard", id, { name: dashboard.name });
  return Response.json({ ok: true });
}
