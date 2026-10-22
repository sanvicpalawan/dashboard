import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { prospectActivities, prospects, users } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { audit } from "@/lib/audit";

import { CHANNELS, OUTCOMES, STAGES } from "@/lib/leads";

export const dynamic = "force-dynamic";
const nullableDate = z.preprocess((value) => value === "" || value === undefined ? null : value, z.string().max(40).nullable().optional());
const prospectSchema = z.object({ businessName: z.string().trim().min(2).max(160), contactName: z.string().max(160).default(""), email: z.string().max(200).default(""), phone: z.string().max(80).default(""), whatsapp: z.string().max(80).default(""), website: z.string().max(500).default(""), socialLinks: z.string().max(1000).default(""), industry: z.string().max(120).default(""), location: z.string().max(160).default(""), source: z.string().max(160).default(""), stage: z.enum(STAGES).default("new"), pitchedServices: z.array(z.string().max(120)).max(20).default([]), estimatedValueMinor: z.number().int().min(0).default(0), notes: z.string().max(10000).default(""), nextFollowUpAt: nullableDate, declinedReason: z.string().max(2000).default(""), ownerId: z.preprocess((value) => value === "" ? null : value, z.string().uuid().nullable().optional()) });
const activitySchema = z.object({ prospectId: z.string().uuid(), channel: z.enum(CHANNELS), type: z.enum(["outreach", "pitch", "response", "note"]).default("outreach"), pitched: z.array(z.string().max(120)).max(20).default([]), outcome: z.enum(OUTCOMES).default("pending"), response: z.string().max(5000).default(""), note: z.string().max(5000).default(""), occurredAt: z.string().max(40).optional() });

export async function GET() {
  const { user, response } = await apiUser("leads.view");
  if (response) return response;
  const rows = await db.select({ prospect: prospects, ownerName: users.name }).from(prospects).leftJoin(users, eq(users.id, prospects.ownerId)).where(eq(prospects.workspaceId, user.workspaceId)).orderBy(desc(prospects.updatedAt));
  const activities = rows.length ? await db.select({ activity: prospectActivities, userName: users.name }).from(prospectActivities).innerJoin(prospects, eq(prospects.id, prospectActivities.prospectId)).leftJoin(users, eq(users.id, prospectActivities.userId)).where(eq(prospects.workspaceId, user.workspaceId)).orderBy(desc(prospectActivities.occurredAt)) : [];
  return Response.json({ prospects: rows.map((row) => ({ ...row.prospect, ownerName: row.ownerName })), activities: activities.map((row) => ({ ...row.activity, userName: row.userName ?? "Former team member" })) });
}

export async function POST(request: Request) {
  const { user, response } = await apiUser("leads.manage");
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
