import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await apiUser("users.manage");
  if (response) return response;
  const id = (await params).id;
  const [row] = await db.select({ session: sessions }).from(sessions).innerJoin(users, eq(users.id, sessions.userId)).where(and(eq(sessions.id, id), eq(users.workspaceId, user.workspaceId), isNull(sessions.revokedAt))).limit(1);
  if (!row) return Response.json({ error: "Active session not found." }, { status: 404 });
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, id));
  await audit(user, "session.revoked", "session", id, { userId: row.session.userId });
  return Response.json({ ok: true });
}
