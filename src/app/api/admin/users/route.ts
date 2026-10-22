import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditEvents, roles, sessions, teams, users } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { hashPassword } from "@/lib/security";

export const dynamic = "force-dynamic";
const provisionSchema = z.object({ action: z.literal("provision"), name: z.string().trim().min(2).max(120), email: z.string().email().max(200), title: z.string().max(120).default(""), roleId: z.string().uuid(), teamId: z.string().uuid().nullable().optional(), temporaryPassword: z.string().min(12).max(300) });
const teamSchema = z.object({ action: z.literal("team"), name: z.string().trim().min(2).max(100), description: z.string().max(500).default(""), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#91a0ff") });
const patchSchema = z.object({ id: z.string().uuid(), name: z.string().trim().min(2).max(120).optional(), title: z.string().max(120).optional(), roleId: z.string().uuid().optional(), teamId: z.string().uuid().nullable().optional(), status: z.enum(["active", "invited", "deactivated"]).optional(), temporaryPassword: z.string().min(12).max(300).optional(), revokeSessions: z.boolean().optional() });

export async function GET() {
  const { user, response } = await apiUser("users.manage");
  if (response) return response;
  const [userRows, roleRows, teamRows, sessionRows, accessRows] = await Promise.all([
    db.select({ id: users.id, name: users.name, email: users.email, title: users.title, status: users.status, roleId: users.roleId, teamId: users.teamId, lastLoginAt: users.lastLoginAt, invitedAt: users.invitedAt, mustChangePassword: users.mustChangePassword, createdAt: users.createdAt }).from(users).where(eq(users.workspaceId, user.workspaceId)).orderBy(desc(users.createdAt)),
    db.select().from(roles).orderBy(roles.name),
    db.select().from(teams).where(eq(teams.workspaceId, user.workspaceId)).orderBy(teams.name),
    db.select({ session: sessions, userName: users.name, email: users.email }).from(sessions).innerJoin(users, eq(users.id, sessions.userId)).where(eq(users.workspaceId, user.workspaceId)).orderBy(desc(sessions.lastSeenAt)).limit(100),
    db.select({ event: auditEvents, actor: users.name }).from(auditEvents).leftJoin(users, eq(users.id, auditEvents.userId)).where(eq(auditEvents.workspaceId, user.workspaceId)).orderBy(desc(auditEvents.createdAt)).limit(30),
  ]);
  return Response.json({ users: userRows, roles: roleRows.map((role) => ({ ...role, permissions: role.permissions })), teams: teamRows, sessions: sessionRows.map((row) => ({ ...row.session, tokenHash: undefined, userName: row.userName, email: row.email })), access: accessRows.filter((row) => row.event.action.startsWith("authentication") || row.event.action.startsWith("user")) });
}

export async function POST(request: Request) {
  const { user, response } = await apiUser("users.manage");
  if (response) return response;
  const body = await request.json();
  if (body?.action === "team") {
    const parsed = teamSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: "Enter a valid team name and color." }, { status: 400 });
    const slug = parsed.data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    try { const [team] = await db.insert(teams).values({ workspaceId: user.workspaceId, name: parsed.data.name, description: parsed.data.description, color: parsed.data.color, slug }).returning(); await audit(user, "team.created", "team", team.id, { name: team.name }); return Response.json({ team }, { status: 201 }); } catch { return Response.json({ error: "A team with a similar name already exists." }, { status: 400 }); }
  }
  const parsed = provisionSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Provision a name, valid email, role and temporary password of at least 12 characters." }, { status: 400 });
  const [role] = await db.select().from(roles).where(eq(roles.id, parsed.data.roleId)).limit(1);
  if (!role) return Response.json({ error: "Role not found." }, { status: 400 });
  if (parsed.data.teamId) { const [team] = await db.select().from(teams).where(and(eq(teams.id, parsed.data.teamId), eq(teams.workspaceId, user.workspaceId))).limit(1); if (!team) return Response.json({ error: "Team not found in this workspace." }, { status: 400 }); }
  try {
    const [created] = await db.insert(users).values({ workspaceId: user.workspaceId, roleId: parsed.data.roleId, teamId: parsed.data.teamId || null, name: parsed.data.name, email: parsed.data.email.toLowerCase(), title: parsed.data.title, passwordHash: hashPassword(parsed.data.temporaryPassword), status: "invited", invitedAt: new Date(), mustChangePassword: true }).returning();
    await audit(user, "user.provisioned", "user", created.id, { email: created.email, role: role.slug, teamId: created.teamId, delivery: "temporary password set by administrator; no email delivery claimed" });
    return Response.json({ user: { id: created.id, name: created.name, email: created.email, status: created.status }, guidance: "Account provisioned as invited. Share the temporary password through your approved secure channel, then activate the account. No invitation email was sent." }, { status: 201 });
  } catch { return Response.json({ error: "A user with this email already exists." }, { status: 400 }); }
}

export async function PATCH(request: Request) {
  const { user, response } = await apiUser("users.manage");
  if (response) return response;
  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid account update. Temporary passwords require at least 12 characters." }, { status: 400 });
  const [target] = await db.select().from(users).where(and(eq(users.id, parsed.data.id), eq(users.workspaceId, user.workspaceId))).limit(1);
  if (!target) return Response.json({ error: "User not found." }, { status: 404 });
  if (target.id === user.id && parsed.data.status === "deactivated") return Response.json({ error: "You cannot deactivate your own active administrator session." }, { status: 400 });
  if (parsed.data.roleId) { const [role] = await db.select().from(roles).where(eq(roles.id, parsed.data.roleId)).limit(1); if (!role) return Response.json({ error: "Role not found." }, { status: 400 }); }
  const passwordHash = parsed.data.temporaryPassword ? hashPassword(parsed.data.temporaryPassword) : undefined;
  const [updated] = await db.update(users).set({ name: parsed.data.name, title: parsed.data.title, roleId: parsed.data.roleId, teamId: parsed.data.teamId, status: parsed.data.status, passwordHash, mustChangePassword: passwordHash ? true : undefined, updatedAt: new Date() }).where(eq(users.id, target.id)).returning();
  if (parsed.data.revokeSessions || parsed.data.status === "deactivated" || passwordHash) await db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, target.id), isNull(sessions.revokedAt)));
  await audit(user, passwordHash ? "user.password_reset" : "user.updated", "user", target.id, { fields: Object.keys(parsed.data).filter((key) => key !== "temporaryPassword"), sessionsRevoked: Boolean(parsed.data.revokeSessions || passwordHash) });
  return Response.json({ user: { id: updated.id, name: updated.name, email: updated.email, status: updated.status } });
}
