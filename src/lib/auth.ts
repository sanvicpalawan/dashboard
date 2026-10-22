import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { roles, sessions, users, workspaces } from "@/db/schema";
import { hashToken } from "@/lib/security";
import { hasPermission, type SessionUser } from "@/lib/permissions";
import { audit } from "@/lib/audit";

export const SESSION_COOKIE = "merqato_session";
export const ACCESS_PAUSE_COOKIE = "merqato_access_paused";

export async function getCurrentUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) {
    if (process.env.DEMO_MODE === "false" || cookieStore.get(ACCESS_PAUSE_COOKIE)?.value === "1") return null;
    const [account] = await db.select({
      id: users.id, workspaceId: users.workspaceId, teamId: users.teamId, roleId: users.roleId,
      roleSlug: roles.slug, roleName: roles.name, name: users.name, email: users.email, title: users.title,
      permissions: roles.permissions, workspaceName: workspaces.name, workspaceSlug: workspaces.slug,
      demoMode: workspaces.demoMode,
    }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).innerJoin(workspaces, eq(workspaces.id, users.workspaceId))
      .where(and(eq(roles.slug, "super-admin"), eq(users.status, "active"), eq(workspaces.demoMode, true))).orderBy(users.createdAt).limit(1);
    return account ? { ...account, sessionId: "" } : null;
  }
  const tokenHash = hashToken(token);
  const [record] = await db
    .select({
      id: users.id,
      workspaceId: users.workspaceId,
      teamId: users.teamId,
      roleId: users.roleId,
      roleSlug: roles.slug,
      roleName: roles.name,
      name: users.name,
      email: users.email,
      title: users.title,
      permissions: roles.permissions,
      workspaceName: workspaces.name,
      workspaceSlug: workspaces.slug,
      demoMode: workspaces.demoMode,
      sessionId: sessions.id,
      sessionLastSeenAt: sessions.lastSeenAt,
      status: users.status,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(roles, eq(roles.id, users.roleId))
    .innerJoin(workspaces, eq(workspaces.id, users.workspaceId))
    .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!record || record.status !== "active") return null;
  if (Date.now() - record.sessionLastSeenAt.getTime() > 300_000) await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, record.sessionId));
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    teamId: record.teamId,
    roleId: record.roleId,
    roleSlug: record.roleSlug,
    roleName: record.roleName,
    name: record.name,
    email: record.email,
    title: record.title,
    permissions: record.permissions,
    workspaceName: record.workspaceName,
    workspaceSlug: record.workspaceSlug,
    demoMode: record.demoMode,
    sessionId: record.sessionId,
  };
}

export async function requireUser(permission?: string) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (permission && !hasPermission(user, permission)) redirect("/?denied=1");
  return user;
}

export async function apiUser(permission?: string) {
  const user = await getCurrentUser();
  if (!user) return { user: null, response: Response.json({ error: "Authentication required." }, { status: 401 }) } as const;
  if (permission && !hasPermission(user, permission)) {
    await audit(user, "authorization.failed", "api", null, { permission });
    return { user: null, response: Response.json({ error: "Your role does not permit this action." }, { status: 403 }) } as const;
  }
  return { user, response: null } as const;
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  const cookieStore = await cookies();
  cookieStore.set(ACCESS_PAUSE_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", expires: new Date(0) });
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", expires: new Date(0) });
  if (process.env.DEMO_MODE !== "false") cookieStore.set(ACCESS_PAUSE_COOKIE, "1", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
}
