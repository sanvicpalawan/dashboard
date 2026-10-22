import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { dashboardAssignments, roles, teams, users } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getAccessibleDashboard } from "@/lib/dashboards";
const schema = z.object({ subjectType: z.enum(["user", "team", "role"]), subjectId: z.string().uuid(), isDefault: z.boolean().default(false) });
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await apiUser("dashboards.manage");
  if (response) return response;
  const dashboard = await getAccessibleDashboard(user, (await params).id);
  if (!dashboard) return Response.json({ error: "Dashboard not found." }, { status: 404 });
  return Response.json({ assignments: await db.select().from(dashboardAssignments).where(eq(dashboardAssignments.dashboardId, dashboard.id)) });
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await apiUser("dashboards.manage");
  if (response) return response;
  const dashboard = await getAccessibleDashboard(user, (await params).id);
  if (!dashboard) return Response.json({ error: "Dashboard not found." }, { status: 404 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid dashboard assignment." }, { status: 400 });
  const { subjectType, subjectId } = parsed.data;
  const valid = subjectType === "role" ? (await db.select({ id: roles.id }).from(roles).where(eq(roles.id, subjectId)).limit(1))[0] : subjectType === "team" ? (await db.select({ id: teams.id }).from(teams).where(and(eq(teams.id, subjectId), eq(teams.workspaceId, user.workspaceId))).limit(1))[0] : (await db.select({ id: users.id }).from(users).where(and(eq(users.id, subjectId), eq(users.workspaceId, user.workspaceId))).limit(1))[0];
  if (!valid) return Response.json({ error: "Assignment subject does not exist in this workspace." }, { status: 400 });
  if (parsed.data.isDefault) await db.update(dashboardAssignments).set({ isDefault: false }).where(and(eq(dashboardAssignments.subjectType, subjectType), eq(dashboardAssignments.subjectId, subjectId)));
  const [assignment] = await db.insert(dashboardAssignments).values({ dashboardId: dashboard.id, subjectType, subjectId, isDefault: parsed.data.isDefault }).onConflictDoUpdate({ target: [dashboardAssignments.dashboardId, dashboardAssignments.subjectType, dashboardAssignments.subjectId], set: { isDefault: parsed.data.isDefault } }).returning();
  await audit(user, "dashboard.assigned", "dashboard", dashboard.id, { subjectType, subjectId, isDefault: assignment.isDefault });
  return Response.json({ assignment }, { status: 201 });
}
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await apiUser("dashboards.manage");
  if (response) return response;
  const dashboard = await getAccessibleDashboard(user, (await params).id);
  if (!dashboard) return Response.json({ error: "Dashboard not found." }, { status: 404 });
  const body = await request.json() as { assignmentId?: string };
  if (!body.assignmentId) return Response.json({ error: "Assignment ID required." }, { status: 400 });
  await db.delete(dashboardAssignments).where(and(eq(dashboardAssignments.id, body.assignmentId), eq(dashboardAssignments.dashboardId, dashboard.id)));
  await audit(user, "dashboard.assignment_removed", "dashboard", dashboard.id, { assignmentId: body.assignmentId });
  return Response.json({ ok: true });
}
