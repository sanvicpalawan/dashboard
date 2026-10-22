import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { tools, users } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { slugify } from "@/lib/utils";
import { toolSchema } from "@/lib/tool-schema";

export const dynamic = "force-dynamic";
export async function GET() {
  const { user, response } = await apiUser("tools.view");
  if (response) return response;
  const rows = await db.select({ tool: tools, builder: users.name }).from(tools).leftJoin(users, eq(users.id, tools.builtById)).where(eq(tools.workspaceId, user.workspaceId)).orderBy(desc(tools.updatedAt));
  return Response.json({ tools: rows.map((row) => ({ ...row.tool, builder: row.builder })) });
}

export async function POST(request: Request) {
  const { user, response } = await apiUser("tools.manage");
  if (response) return response;
  const parsed = toolSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Tool validation failed." }, { status: 400 });
  const [tool] = await db.insert(tools).values({ ...parsed.data, workspaceId: user.workspaceId, builtById: user.id, builtByName: parsed.data.builtByName || user.name, slug: `${slugify(parsed.data.name)}-${Date.now().toString(36).slice(-4)}` }).returning();
  await audit(user, "tool.created", "tool", tool.id, { name: tool.name });
  return Response.json({ tool }, { status: 201 });
}
