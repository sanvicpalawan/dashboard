import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { dashboards, dashboardVersions } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { listAccessibleDashboards, snapshotDashboard } from "@/lib/dashboards";
import { slugify } from "@/lib/utils";

export const dynamic = "force-dynamic";
const createSchema = z.object({ name: z.string().trim().min(2).max(100), description: z.string().max(500).default(""), audience: z.enum(["agency", "team", "individual", "client", "function"]).default("agency"), teamId: z.string().uuid().nullable().optional() });

export async function GET() {
  const { user, response } = await apiUser("dashboards.view");
  if (response) return response;
  const records = await listAccessibleDashboards(user);
  return Response.json({ dashboards: records });
}

export async function POST(request: Request) {
  const { user, response } = await apiUser("dashboards.manage");
  if (response) return response;
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Enter a dashboard name and valid audience." }, { status: 400 });
  const slug = `${slugify(parsed.data.name)}-${Date.now().toString(36).slice(-4)}`;
  const [dashboard] = await db.insert(dashboards).values({ ...parsed.data, workspaceId: user.workspaceId, ownerId: user.id, slug, teamId: parsed.data.audience === "team" ? parsed.data.teamId : null, status: "draft" }).returning();
  const snapshot = await snapshotDashboard(dashboard);
  await db.insert(dashboardVersions).values({ dashboardId: dashboard.id, version: 1, snapshot, note: "Draft created", createdBy: user.id });
  await audit(user, "dashboard.created", "dashboard", dashboard.id, { name: dashboard.name, audience: dashboard.audience });
  return Response.json({ dashboard }, { status: 201 });
}
