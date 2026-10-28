import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { notifications, roles, users, workspaces } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { validateAgentOrVaultToken } from "@/lib/agent-auth";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().max(4000).default(""),
  type: z.enum(["info", "warning", "error", "success"]).default("info"),
  link: z.string().max(500).nullable().optional(),
});

/**
 * POST /api/notifications — create a notification.
 *
 * Notifications are per-user, but the health worker is not a user: it has no
 * account and no role. So an agent bearer token posts to the workspace's active
 * super-admin, and a browser session still posts to itself. Nothing here reads
 * a lead, a credential or a setting — the blast radius of a stolen agent token
 * on this route is a spurious notification.
 */
export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid notification." }, { status: 400 });
  const values = { title: parsed.data.title, body: parsed.data.body, type: parsed.data.type, link: parsed.data.link ?? null };

  if (validateAgentOrVaultToken(request)) {
    const [workspace] = await db.select({ id: workspaces.id }).from(workspaces).limit(1);
    if (!workspace) return Response.json({ error: "No workspace is configured." }, { status: 404 });

    const activeUsers = db
      .select({ id: users.id })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId));

    const [admin] = await activeUsers
      .where(and(eq(users.workspaceId, workspace.id), eq(users.status, "active"), eq(roles.slug, "super-admin")))
      .orderBy(users.createdAt)
      .limit(1);

    const [recipient] = admin
      ? [admin]
      : await activeUsers
          .where(and(eq(users.workspaceId, workspace.id), eq(users.status, "active")))
          .orderBy(users.createdAt)
          .limit(1);

    if (!recipient) return Response.json({ error: "No active account exists to notify." }, { status: 409 });

    const [created] = await db.insert(notifications).values({ ...values, userId: recipient.id }).returning();
    return Response.json({ ok: true, notification: created }, { status: 201 });
  }

  const { user, response } = await apiUser();
  if (response) return response;

  const [created] = await db.insert(notifications).values({ ...values, userId: user.id }).returning();
  return Response.json({ ok: true, notification: created }, { status: 201 });
}

export async function PATCH(request: Request) {
  const { user, response } = await apiUser();
  if (response) return response;
  const parsed = z.object({ id: z.string().uuid().optional() }).safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid notification." }, { status: 400 });
  await db.update(notifications).set({ readAt: new Date() }).where(parsed.data.id ? and(eq(notifications.id, parsed.data.id), eq(notifications.userId, user.id)) : and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
  return Response.json({ ok: true });
}
