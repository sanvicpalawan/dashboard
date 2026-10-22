import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { themes } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { slugify } from "@/lib/utils";
const schema = z.object({ name: z.string().trim().min(2).max(80), description: z.string().max(300).default(""), mode: z.enum(["dark", "light"]), colors: z.record(z.string(), z.string().regex(/^#[0-9a-fA-F]{6}$/)), typography: z.enum(["inter", "mono"]), density: z.enum(["compact", "comfortable"]), cardStyle: z.enum(["bordered", "soft", "flat"]), sidebarStyle: z.enum(["solid", "contrast", "floating"]) });
export async function POST(request: Request) {
  const { user, response } = await apiUser("appearance.manage");
  if (response) return response;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Custom theme validation failed. Use six-digit hex colors." }, { status: 400 });
  const required = ["background", "surface", "elevated", "text", "muted", "border", "accent", "accentText"];
  if (required.some((key) => !parsed.data.colors[key])) return Response.json({ error: "All palette colors are required." }, { status: 400 });
  const [theme] = await db.insert(themes).values({ ...parsed.data, workspaceId: user.workspaceId, slug: `${slugify(parsed.data.name)}-${Date.now().toString(36).slice(-4)}`, builtIn: false, isDefault: false }).returning();
  await audit(user, "theme.created", "theme", theme.id, { name: theme.name, mode: theme.mode });
  return Response.json({ theme }, { status: 201 });
}
export async function DELETE(request: Request) {
  const { user, response } = await apiUser("appearance.manage");
  if (response) return response;
  const body = await request.json() as { id?: string; confirm?: boolean };
  if (!body.id || !body.confirm) return Response.json({ error: "Confirmation required." }, { status: 400 });
  const [deleted] = await db.delete(themes).where(and(eq(themes.id, body.id), eq(themes.workspaceId, user.workspaceId), eq(themes.builtIn, false))).returning();
  if (!deleted) return Response.json({ error: "Custom theme not found; built-in themes cannot be deleted." }, { status: 404 });
  await audit(user, "theme.deleted", "theme", deleted.id, { name: deleted.name });
  return Response.json({ ok: true });
}
