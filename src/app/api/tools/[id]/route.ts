import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { toolComments, toolFiles, toolLinks, toolMedia, tools, users } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { hasPermission } from "@/lib/permissions";
import { toolSchema } from "@/lib/tool-schema";

export const dynamic = "force-dynamic";
const httpsUrl = z.string().url().max(2000).refine((value) => /^https?:\/\//.test(value), "Only HTTP(S) URLs are allowed.");
const uploadOrHttps = z.string().max(2000).refine((value) => /^https?:\/\//.test(value) || /^\/api\/uploads\/[0-9a-f-]{36}$/.test(value), "Use an HTTPS URL or an uploaded image.");
const itemSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("link"), label: z.string().trim().min(1).max(120), url: httpsUrl, linkKind: z.enum(["repository", "vercel", "production", "preview", "docs", "issues", "design", "other"]).default("other") }),
  z.object({ kind: z.literal("media"), type: z.enum(["image", "video"]), url: uploadOrHttps, caption: z.string().max(300).default("") }),
  z.object({ kind: z.literal("comment"), body: z.string().trim().min(1).max(5000), attachments: z.array(z.object({ url: uploadOrHttps, name: z.string().max(200) })).max(6).default([]) }),
]);

async function loadTool(workspaceId: string, id: string) {
  const [row] = await db.select({ tool: tools, builder: users.name }).from(tools).leftJoin(users, eq(users.id, tools.builtById)).where(and(eq(tools.id, id), eq(tools.workspaceId, workspaceId))).limit(1);
  return row ?? null;
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await apiUser("tools.view");
  if (response) return response;
  const id = (await params).id;
  const row = await loadTool(user.workspaceId, id);
  if (!row) return Response.json({ error: "Tool not found." }, { status: 404 });
  const [links, media, files, comments] = await Promise.all([
    db.select().from(toolLinks).where(eq(toolLinks.toolId, id)).orderBy(asc(toolLinks.createdAt)),
    db.select({ media: toolMedia, author: users.name }).from(toolMedia).leftJoin(users, eq(users.id, toolMedia.uploadedBy)).where(eq(toolMedia.toolId, id)).orderBy(desc(toolMedia.createdAt)),
    db.select({ id: toolFiles.id, filename: toolFiles.filename, mimeType: toolFiles.mimeType, size: toolFiles.size, description: toolFiles.description, version: toolFiles.version, createdAt: toolFiles.createdAt, author: users.name }).from(toolFiles).leftJoin(users, eq(users.id, toolFiles.uploadedBy)).where(eq(toolFiles.toolId, id)).orderBy(desc(toolFiles.createdAt)),
    db.select({ comment: toolComments, author: users.name, authorTitle: users.title, authorId: users.id }).from(toolComments).leftJoin(users, eq(users.id, toolComments.userId)).where(eq(toolComments.toolId, id)).orderBy(asc(toolComments.createdAt)),
  ]);
  return Response.json({ tool: { ...row.tool, builder: row.builder }, links, media: media.map((item) => ({ ...item.media, author: item.author })), files, comments: comments.map((item) => ({ ...item.comment, author: item.author ?? "Former team member", authorTitle: item.authorTitle ?? "", authorId: item.authorId })), viewer: { id: user.id, canManage: hasPermission(user, "tools.manage") } });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await apiUser("tools.manage");
  if (response) return response;
  const id = (await params).id;
  if (!(await loadTool(user.workspaceId, id))) return Response.json({ error: "Tool not found." }, { status: 404 });
  const parsed = toolSchema.partial().safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Validation failed." }, { status: 400 });
  const [tool] = await db.update(tools).set({ ...parsed.data, updatedAt: new Date() }).where(eq(tools.id, id)).returning();
  await audit(user, "tool.updated", "tool", id, { fields: Object.keys(parsed.data) });
  return Response.json({ tool });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await apiUser("tools.view");
  if (response) return response;
  const id = (await params).id;
  if (!(await loadTool(user.workspaceId, id))) return Response.json({ error: "Tool not found." }, { status: 404 });
  const parsed = itemSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Validation failed." }, { status: 400 });
  const data = parsed.data;
  if (data.kind !== "comment" && !hasPermission(user, "tools.manage")) return Response.json({ error: "Adding links and media requires tools.manage." }, { status: 403 });
  if (data.kind === "link") { const [item] = await db.insert(toolLinks).values({ toolId: id, label: data.label, url: data.url, kind: data.linkKind }).returning(); await audit(user, "tool.link_added", "tool", id, { label: data.label }); return Response.json({ item }, { status: 201 }); }
  if (data.kind === "media") { const [item] = await db.insert(toolMedia).values({ toolId: id, uploadedBy: user.id, type: data.type, url: data.url, caption: data.caption }).returning(); await audit(user, "tool.media_added", "tool", id, { type: data.type }); return Response.json({ item: { ...item, author: user.name } }, { status: 201 }); }
  const [comment] = await db.insert(toolComments).values({ toolId: id, userId: user.id, body: data.body, attachments: data.attachments }).returning();
  await audit(user, "tool.comment_added", "tool", id, { attachments: data.attachments.length });
  return Response.json({ item: { ...comment, author: user.name, authorTitle: user.title, authorId: user.id } }, { status: 201 });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await apiUser("tools.view");
  if (response) return response;
  const id = (await params).id;
  const row = await loadTool(user.workspaceId, id);
  if (!row) return Response.json({ error: "Tool not found." }, { status: 404 });
  const body = await request.json().catch(() => ({})) as { kind?: string; itemId?: string; confirmation?: string };
  const manage = hasPermission(user, "tools.manage");
  if (body.kind === "tool") {
    if (!manage) return Response.json({ error: "Deleting a tool requires tools.manage." }, { status: 403 });
    if (body.confirmation !== row.tool.name) return Response.json({ error: "Type the exact tool name to confirm deletion." }, { status: 400 });
    await db.delete(tools).where(eq(tools.id, id));
    await audit(user, "tool.deleted", "tool", id, { name: row.tool.name });
    return Response.json({ ok: true });
  }
  if (!body.itemId || !["link", "media", "file", "comment"].includes(body.kind || "")) return Response.json({ error: "Specify the item to remove." }, { status: 400 });
  if (body.kind === "comment") {
    const [comment] = await db.select().from(toolComments).where(and(eq(toolComments.id, body.itemId), eq(toolComments.toolId, id))).limit(1);
    if (!comment) return Response.json({ error: "Comment not found." }, { status: 404 });
    if (!manage && comment.userId !== user.id) return Response.json({ error: "You can only remove your own comments." }, { status: 403 });
    await db.delete(toolComments).where(eq(toolComments.id, comment.id));
  } else {
    if (!manage) return Response.json({ error: "Removing items requires tools.manage." }, { status: 403 });
    const table = body.kind === "link" ? toolLinks : body.kind === "media" ? toolMedia : toolFiles;
    await db.delete(table).where(and(eq(table.id, body.itemId), eq(table.toolId, id)));
  }
  await audit(user, `tool.${body.kind}_removed`, "tool", id, { itemId: body.itemId });
  return Response.json({ ok: true });
}
