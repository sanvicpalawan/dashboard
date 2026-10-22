import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { clients, projectComments, projectLinks, projectMedia, projects, tasks, users } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { hasPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";
const httpsUrl = z.string().url().max(2000).refine((value) => /^https?:\/\//.test(value), "Only HTTP(S) URLs are allowed.");
const uploadOrHttps = z.string().max(2000).refine((value) => /^https?:\/\//.test(value) || /^\/api\/uploads\/[0-9a-f-]{36}$/.test(value), "Use an HTTPS URL or an uploaded image.");
const schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("link"), label: z.string().trim().min(1).max(120), url: httpsUrl, linkKind: z.enum(["production", "preview", "repository", "design", "document", "other"]).default("other") }),
  z.object({ kind: z.literal("media"), type: z.enum(["image", "video"]), url: uploadOrHttps, caption: z.string().max(300).default("") }),
  z.object({ kind: z.literal("comment"), body: z.string().trim().min(1).max(5000), attachments: z.array(z.object({ url: uploadOrHttps, name: z.string().max(200) })).max(6).default([]) }),
]);

async function loadProject(workspaceId: string, id: string) {
  const [row] = await db.select({ project: projects, clientName: clients.name, leadName: users.name }).from(projects).leftJoin(clients, eq(clients.id, projects.clientId)).leftJoin(users, eq(users.id, projects.leadId)).where(and(eq(projects.id, id), eq(projects.workspaceId, workspaceId))).limit(1);
  return row ?? null;
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await apiUser("projects.view");
  if (response) return response;
  const id = (await params).id;
  const row = await loadProject(user.workspaceId, id);
  if (!row) return Response.json({ error: "Project not found." }, { status: 404 });
  const [links, media, comments, taskRows] = await Promise.all([
    db.select({ link: projectLinks, author: users.name }).from(projectLinks).leftJoin(users, eq(users.id, projectLinks.createdBy)).where(eq(projectLinks.projectId, id)).orderBy(asc(projectLinks.createdAt)),
    db.select({ media: projectMedia, author: users.name }).from(projectMedia).leftJoin(users, eq(users.id, projectMedia.uploadedBy)).where(eq(projectMedia.projectId, id)).orderBy(desc(projectMedia.createdAt)),
    db.select({ comment: projectComments, author: users.name, authorTitle: users.title, authorId: users.id }).from(projectComments).leftJoin(users, eq(users.id, projectComments.userId)).where(eq(projectComments.projectId, id)).orderBy(asc(projectComments.createdAt)),
    db.select({ task: tasks, assignee: users.name }).from(tasks).leftJoin(users, eq(users.id, tasks.assigneeId)).where(eq(tasks.projectId, id)).orderBy(asc(tasks.dueDate)),
  ]);
  return Response.json({ project: { ...row.project, clientName: row.clientName, leadName: row.leadName }, links: links.map((item) => ({ ...item.link, author: item.author })), media: media.map((item) => ({ ...item.media, author: item.author })), comments: comments.map((item) => ({ ...item.comment, author: item.author ?? "Former team member", authorTitle: item.authorTitle ?? "", authorId: item.authorId })), tasks: taskRows.map((item) => ({ ...item.task, assignee: item.assignee })), viewer: { id: user.id, canManage: hasPermission(user, "projects.manage") } });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await apiUser("projects.view");
  if (response) return response;
  const id = (await params).id;
  const row = await loadProject(user.workspaceId, id);
  if (!row) return Response.json({ error: "Project not found." }, { status: 404 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Validation failed." }, { status: 400 });
  const data = parsed.data;
  if (data.kind !== "comment" && !hasPermission(user, "projects.manage")) return Response.json({ error: "Adding links and media requires projects.manage." }, { status: 403 });
  if (data.kind === "link") {
    const [link] = await db.insert(projectLinks).values({ projectId: id, createdBy: user.id, label: data.label, url: data.url, kind: data.linkKind }).returning();
    await audit(user, "project.link_added", "project", id, { label: data.label });
    return Response.json({ item: { ...link, author: user.name } }, { status: 201 });
  }
  if (data.kind === "media") {
    const [media] = await db.insert(projectMedia).values({ projectId: id, uploadedBy: user.id, type: data.type, url: data.url, caption: data.caption }).returning();
    await audit(user, "project.media_added", "project", id, { type: data.type });
    return Response.json({ item: { ...media, author: user.name } }, { status: 201 });
  }
  const [comment] = await db.insert(projectComments).values({ projectId: id, userId: user.id, body: data.body, attachments: data.attachments }).returning();
  await audit(user, "project.comment_added", "project", id, { attachments: data.attachments.length });
  return Response.json({ item: { ...comment, author: user.name, authorTitle: user.title, authorId: user.id } }, { status: 201 });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await apiUser("projects.view");
  if (response) return response;
  const id = (await params).id;
  const row = await loadProject(user.workspaceId, id);
  if (!row) return Response.json({ error: "Project not found." }, { status: 404 });
  const body = await request.json().catch(() => ({})) as { kind?: string; itemId?: string };
  if (!body.itemId || !["link", "media", "comment"].includes(body.kind || "")) return Response.json({ error: "Specify the item to remove." }, { status: 400 });
  const manage = hasPermission(user, "projects.manage");
  if (body.kind === "comment") {
    const [comment] = await db.select().from(projectComments).where(and(eq(projectComments.id, body.itemId), eq(projectComments.projectId, id))).limit(1);
    if (!comment) return Response.json({ error: "Comment not found." }, { status: 404 });
    if (!manage && comment.userId !== user.id) return Response.json({ error: "You can only remove your own comments." }, { status: 403 });
    await db.delete(projectComments).where(eq(projectComments.id, comment.id));
  } else {
    if (!manage) return Response.json({ error: "Removing links and media requires projects.manage." }, { status: 403 });
    const table = body.kind === "link" ? projectLinks : projectMedia;
    await db.delete(table).where(and(eq(table.id, body.itemId), eq(table.projectId, id)));
  }
  await audit(user, `project.${body.kind}_removed`, "project", id, { itemId: body.itemId });
  return Response.json({ ok: true });
}
