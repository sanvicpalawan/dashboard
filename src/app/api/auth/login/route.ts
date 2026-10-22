import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { ensureBootstrap } from "@/db/bootstrap";
import { appSettings, roles, sessions, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { setSessionCookie } from "@/lib/auth";
import { checkRateLimit, createSessionToken, hashToken, verifyPassword } from "@/lib/security";
import { demoModeEnabled } from "@/lib/demo";

export const dynamic = "force-dynamic";

const GENERIC_ERROR = "Email or password is incorrect.";

async function startSession(account: typeof users.$inferSelect, ip: string, userAgent: string, method: string, metadata: Record<string, unknown> = {}) {
  const [setting] = await db.select().from(appSettings).where(eq(appSettings.key, `workspace:${account.workspaceId}`)).limit(1);
  const config = setting?.value as { sessionHours?: number } | null;
  const expiresAt = new Date(Date.now() + Math.min(168, Math.max(1, config?.sessionHours ?? 12)) * 3600_000);
  const token = createSessionToken();
  const [session] = await db.insert(sessions).values({ userId: account.id, tokenHash: hashToken(token), expiresAt, ipAddress: ip, userAgent: userAgent.slice(0, 500) }).returning();
  await db.update(users).set({ lastLoginAt: new Date(), updatedAt: new Date() }).where(eq(users.id, account.id));
  await setSessionCookie(token, expiresAt);
  await audit(null, "authentication.succeeded", "session", session.id, { method, ...metadata }, account.workspaceId);
  return Response.json({ ok: true, user: { id: account.id, name: account.name } });
}

async function passwordLogin(body: Record<string, unknown>, ip: string, userAgent: string) {
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!email || !password) return Response.json({ error: "Email and password are required." }, { status: 400 });
  const perAccount = checkRateLimit(`login:account:${email}`, 8, 300_000);
  if (!perAccount.allowed) return Response.json({ error: `Too many sign-in attempts for this account. Retry in ${perAccount.retryAfter} seconds.` }, { status: 429 });
  await ensureBootstrap();
  const [account] = await db.select().from(users).where(and(sql`lower(${users.email}) = ${email}`, eq(users.status, "active"))).limit(1);
  if (!account || !verifyPassword(password, account.passwordHash)) {
    await audit(null, "authentication.failed", "user", account?.id ?? null, { reason: "invalid-credentials" }, account?.workspaceId);
    return Response.json({ error: GENERIC_ERROR }, { status: 401 });
  }
  return startSession(account, ip, userAgent, "password", { mustChangePassword: account.mustChangePassword });
}

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const userAgent = request.headers.get("user-agent") || "";
  const rate = checkRateLimit(`login:ip:${ip}`, 20, 60_000);
  if (!rate.allowed) return Response.json({ error: `Too many sign-in attempts. Retry in ${rate.retryAfter} seconds.` }, { status: 429 });

  let body: Record<string, unknown> = {};
  try { body = await request.json() as Record<string, unknown>; } catch { return Response.json({ error: "Request body must be JSON." }, { status: 400 }); }

  if (body.email || body.password) {
    if (process.env.NODE_ENV === "production" && !process.env.CREDENTIAL_ENCRYPTION_KEY && !process.env.AUTH_SECRET) {
      return Response.json({ error: "Server authentication keys are not configured." }, { status: 503 });
    }
    return passwordLogin(body, ip, userAgent);
  }

  // Passwordless workspace access exists only as an explicit, isolated demo/development option.
  if (!demoModeEnabled()) {
    return Response.json({ error: "Passwordless access is disabled. Sign in with your email and password." }, { status: 403 });
  }
  try {
    await ensureBootstrap();
    const [user] = await db.select({ user: users }).from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(eq(roles.slug, "super-admin"), eq(users.status, "active")))
      .orderBy(desc(users.lastLoginAt))
      .limit(1);
    if (!user) return Response.json({ error: "No active administrator is available for local workspace access." }, { status: 503 });
    return startSession(user.user, ip, userAgent, "passwordless-demo", { temporaryDevelopmentFlow: true });
  } catch (error) {
    console.error("Local workspace access failed:", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "The workspace is temporarily unavailable. Check application and database health." }, { status: 500 });
  }
}
