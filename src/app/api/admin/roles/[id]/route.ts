import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { roles } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ALL_PERMISSIONS } from "@/lib/permissions";
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await apiUser("roles.manage");
  if (response) return response;
  const id = (await params).id;
  const parsed = z.object({ permissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])).max(100), description: z.string().max(500).optional() }).safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Permission list contains unsupported values." }, { status: 400 });
  const [role] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
  if (!role) return Response.json({ error: "Role not found." }, { status: 404 });
  if (role.slug === "super-admin") return Response.json({ error: "The Super Administrator role is protected and always retains full permissions." }, { status: 400 });
  if (role.slug === "client-viewer" && parsed.data.permissions.some((permission) => permission !== "dashboards.view")) return Response.json({ error: "Client Viewer is reserved for a future portal and cannot receive internal permissions yet." }, { status: 400 });
  const [updated] = await db.update(roles).set({ permissions: parsed.data.permissions, description: parsed.data.description, updatedAt: new Date() }).where(and(eq(roles.id, id), eq(roles.isSystem, true))).returning();
  await audit(user, "role.permissions_updated", "role", id, { role: role.slug, permissions: parsed.data.permissions });
  return Response.json({ role: updated });
}
