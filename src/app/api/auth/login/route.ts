import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { ensureBootstrap } from "@/db/bootstrap";
import { appSettings, roles, sessions, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { setSessionCookie } from "@/lib/auth";
import { checkRateLimit, createSessionToken, hashToken } from "@/lib/security";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const rate = checkRateLimit(`local-access:${ip}`, 20, 60_000);
  if (!rate.allowed) return Response.json({ error: `Too many workspace access attempts. Retry in ${rate.retryAfter} seconds.` }, { status: 429 });
  if (process.env.DEMO_MODE === "false") {
    return Response.json({ error: "Email authentication is temporarily disabled. Passwordless workspace access is only available in demo/development mode." }, { status: 503 });
  }
  try {
    await ensureBootstrap();
    const [user] = await db.select({ user: users }).from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(eq(roles.slug, "super-admin"), eq(users.status, "active")))
      .orderBy(desc(users.lastLoginAt))
      .limit(1);
    if (!user) return Response.json({ error: "No active administrator is available for local workspace access." }, { status: 503 });
    const account = user.user;
    const [setting] = await db.select().from(appSettings).where(eq(appSettings.key, `workspace:${account.workspaceId}`)).limit(1);
    const config = setting?.value as { sessionHours?: number };
    const expiresAt = new Date(Date.now() + Math.min(168, Math.max(1, config?.sessionHours ?? 12)) * 3600_000);
    const token = createSessionToken();
    const [session] = await db.insert(sessions).values({ userId: account.id, tokenHash: hashToken(token), expiresAt, ipAddress: ip, userAgent: (request.headers.get("user-agent") || "").slice(0, 500) }).returning();
    await db.update(users).set({ lastLoginAt: new Date(), updatedAt: new Date() }).where(eq(users.id, account.id));
    await setSessionCookie(token, expiresAt);
    await audit(null, "authentication.succeeded", "session", session.id, { method: "passwordless-demo", temporaryDevelopmentFlow: true }, account.workspaceId);
    return Response.json({ ok: true, user: { id: account.id, name: account.name } });
  } catch (error) {
    console.error("Local workspace access failed:", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "The workspace is temporarily unavailable. Check application and database health." }, { status: 500 });
  }
}
