import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sessions } from "@/db/schema";
import { clearSessionCookie, getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function POST() {
  const user = await getCurrentUser();
  if (user) {
    if (user.sessionId) await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, user.sessionId));
    await audit(user, "authentication.logout", "session", user.sessionId || null, { method: user.sessionId ? "session" : "demo-context" });
  }
  await clearSessionCookie();
  return Response.json({ ok: true });
}
