import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { prospectActivities, prospects, roles, users, workspaces } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { validateAgentToken } from "@/lib/agent-auth";
import { audit } from "@/lib/audit";
import type { SessionUser } from "@/lib/permissions";

import { CHANNELS, OUTCOMES, STAGES, VERIFICATIONS } from "@/lib/leads";

export const dynamic = "force-dynamic";
const nullableDate = z.preprocess((value) => value === "" || value === undefined ? null : value, z.string().max(40).nullable().optional());
const prospectSchema = z.object({ businessName: z.string().trim().min(2).max(160), contactName: z.string().max(160).default(""), email: z.string().max(200).default(""), phone: z.string().max(80).default(""), whatsapp: z.string().max(80).default(""), website: z.string().max(500).default(""), socialLinks: z.string().max(1000).default(""), industry: z.string().max(120).default(""), location: z.string().max(160).default(""), source: z.string().max(160).default(""), stage: z.enum(STAGES).default("new"), verification: z.enum(VERIFICATIONS).default("unverified"), pitchedServices: z.array(z.string().max(120)).max(20).default([]), estimatedValueMinor: z.number().int().min(0).default(0), notes: z.string().max(10000).default(""), nextFollowUpAt: nullableDate, declinedReason: z.string().max(2000).default(""), ownerId: z.preprocess((value) => value === "" ? null : value, z.string().uuid().nullable().optional()) });
const activitySchema = z.object({ prospectId: z.string().uuid(), channel: z.enum(CHANNELS), type: z.enum(["outreach", "pitch", "response", "note"]).default("outreach"), pitched: z.array(z.string().max(120)).max(20).default([]), outcome: z.enum(OUTCOMES).default("pending"), response: z.string().max(5000).default(""), note: z.string().max(5000).default(""), occurredAt: z.string().max(40).optional() });

/**
 * Resolve the acting identity for a leads request.
 *
 * A signed-in account with the permission wins. Otherwise the agent bearer
 * secret (`AGENT_API_KEY`) may act — but an agent is not a user, so it cannot
 * inherit a role: it is bound to the single workspace this deployment serves,
 * the same way /api/system resolves it. That keeps every query below scoped to
 * a real workspace instead of letting the agent read across tenants.
 *
 * Returns `{ user }` on success, or `{ response }` with the 401/403 to send.
 */
async function resolveActor(request: Request, permission: string) {
  const { user, response } = await apiUser(permission);
  if (!response) return { user };

  // Only a genuine authentication failure (401) falls through to the agent
  // path. A 403 means the account exists but lacks the permission — an
  // authorisation decision the agent token must not undo. apiUser returns
  // `user: null` for both, so the status is the only reliable signal.
  if (response.status === 401 && validateAgentToken(request)) {
    const [workspace] = await db
      .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug, demoMode: workspaces.demoMode })
      .from(workspaces)
      .limit(1);
    if (!workspace) return { response: Response.json({ error: "No workspace is configured." }, { status: 404 }) } as const;
    // Resolve a concrete account so the write has an owner and the audit trail
    // has a user. It is only an attribution anchor: `permissions` is left empty
    // so the agent cannot satisfy hasPermission() and gains nothing beyond what
    // this handler explicitly allows.
    const [account] = await db
      .select({
        id: users.id, workspaceId: users.workspaceId, teamId: users.teamId, roleId: users.roleId,
        name: users.name, email: users.email, title: users.title,
        roleSlug: roles.slug, roleName: roles.name,
      })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(eq(users.workspaceId, workspace.id), eq(users.status, "active")))
      .limit(1);
    if (!account) return { response: Response.json({ error: "No active account exists to attribute this action to." }, { status: 409 }) } as const;
    const agentUser: SessionUser = {
      ...account,
      permissions: [],
      workspaceName: workspace.name,
      workspaceSlug: workspace.slug,
      demoMode: workspace.demoMode,
      sessionId: "",
    };
    return { user: agentUser } as const;
  }

  return { response } as const;
}

export async function GET(request: Request) {
  const { user, response } = await resolveActor(request, "leads.view");
  if (response) return response;
  const rows = await db.select({ prospect: prospects, ownerName: users.name }).from(prospects).leftJoin(users, eq(users.id, prospects.ownerId)).where(eq(prospects.workspaceId, user.workspaceId)).orderBy(desc(prospects.updatedAt));
  const activities = rows.length ? await db.select({ activity: prospectActivities, userName: users.name }).from(prospectActivities).innerJoin(prospects, eq(prospects.id, prospectActivities.prospectId)).leftJoin(users, eq(users.id, prospectActivities.userId)).where(eq(prospects.workspaceId, user.workspaceId)).orderBy(desc(prospectActivities.occurredAt)) : [];
  return Response.json({ prospects: rows.map((row) => ({ ...row.prospect, ownerName: row.ownerName })), activities: activities.map((row) => ({ ...row.activity, userName: row.userName ?? "Former team member" })) });
}

export async function POST(request: Request) {
  const { user, response } = await resolveActor(request, "leads.manage");
  if (response) return response;
  const body = await request.json();
  if (body?.kind === "activity") {
    const parsed = activitySchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: "Activity validation failed." }, { status: 400 });
    const [prospect] = await db.select().from(prospects).where(and(eq(prospects.id, parsed.data.prospectId), eq(prospects.workspaceId, user.workspaceId))).limit(1);
    if (!prospect) return Response.json({ error: "Prospect not found." }, { status: 404 });
    const occurredAt = parsed.data.occurredAt ? new Date(parsed.data.occurredAt) : new Date();
    if (Number.isNaN(occurredAt.getTime())) return Response.json({ error: "Invalid activity date." }, { status: 400 });
    const [activity] = await db.insert(prospectActivities).values({ ...parsed.data, userId: user.id, occurredAt }).returning();
    const pitchedServices = [...new Set([...prospect.pitchedServices, ...parsed.data.pitched])];
    const stage = parsed.data.outcome === "won" ? "won" : parsed.data.outcome === "declined" ? "declined" : parsed.data.outcome === "no_response" && ["new", "contacted"].includes(prospect.stage) ? "no_response" : parsed.data.type === "pitch" && ["new", "contacted", "no_response"].includes(prospect.stage) ? "pitched" : prospect.stage === "new" ? "contacted" : prospect.stage;
    await db.update(prospects).set({ pitchedServices, stage, lastContactAt: occurredAt, declinedAt: parsed.data.outcome === "declined" ? occurredAt : prospect.declinedAt, declinedReason: parsed.data.outcome === "declined" && parsed.data.response ? parsed.data.response : prospect.declinedReason, updatedAt: new Date() }).where(eq(prospects.id, prospect.id));
    await audit(user, "prospect.activity_logged", "prospect", prospect.id, { channel: parsed.data.channel, outcome: parsed.data.outcome });
    return Response.json({ activity: { ...activity, userName: user.name } }, { status: 201 });
  }
  const parsed = prospectSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Enter at least a business name and valid fields." }, { status: 400 });
  const [prospect] = await db.insert(prospects).values({ ...parsed.data, workspaceId: user.workspaceId, ownerId: parsed.data.ownerId ?? user.id, declinedAt: parsed.data.stage === "declined" ? new Date() : null }).returning();
  await audit(user, "prospect.created", "prospect", prospect.id, { businessName: prospect.businessName });
  return Response.json({ prospect }, { status: 201 });
}

export async function PATCH(request: Request) {
  const { user, response } = await apiUser("leads.manage");
  if (response) return response;
  const body = await request.json() as { id?: string; data?: unknown };
  if (!body.id) return Response.json({ error: "Prospect ID required." }, { status: 400 });
  const [existing] = await db.select().from(prospects).where(and(eq(prospects.id, body.id), eq(prospects.workspaceId, user.workspaceId))).limit(1);
  if (!existing) return Response.json({ error: "Prospect not found." }, { status: 404 });
  const parsed = prospectSchema.partial().safeParse(body.data);
  if (!parsed.success) return Response.json({ error: "Validation failed." }, { status: 400 });
  const nextStage = parsed.data.stage as string | undefined;
  const declinedAt = nextStage === "declined" ? existing.declinedAt ?? new Date() : nextStage ? null : existing.declinedAt;
  const [prospect] = await db.update(prospects).set({ ...parsed.data, declinedAt, updatedAt: new Date() }).where(eq(prospects.id, existing.id)).returning();
  await audit(user, "prospect.updated", "prospect", prospect.id, { fields: Object.keys(parsed.data) });
  return Response.json({ prospect });
}

export async function DELETE(request: Request) {
  const { user, response } = await apiUser("leads.manage");
  if (response) return response;
  const body = await request.json() as { id?: string; confirm?: boolean };
  if (!body.id || !body.confirm) return Response.json({ error: "Confirmation required." }, { status: 400 });
  const [deleted] = await db.delete(prospects).where(and(eq(prospects.id, body.id), eq(prospects.workspaceId, user.workspaceId))).returning();
  if (!deleted) return Response.json({ error: "Prospect not found." }, { status: 404 });
  await audit(user, "prospect.deleted", "prospect", deleted.id, { businessName: deleted.businessName });
  return Response.json({ ok: true });
}
