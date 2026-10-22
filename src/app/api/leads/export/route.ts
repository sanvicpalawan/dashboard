import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { prospectActivities, prospects, users } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";
const cell = (value: unknown) => { const text = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value); return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; };

export async function GET() {
  const { user, response } = await apiUser("leads.view");
  if (response) return response;
  const rows = await db.select({ prospect: prospects, ownerName: users.name }).from(prospects).leftJoin(users, eq(users.id, prospects.ownerId)).where(eq(prospects.workspaceId, user.workspaceId)).orderBy(desc(prospects.updatedAt));
  const activities = rows.length ? await db.select({ activity: prospectActivities, userName: users.name }).from(prospectActivities).innerJoin(prospects, eq(prospects.id, prospectActivities.prospectId)).leftJoin(users, eq(users.id, prospectActivities.userId)).where(eq(prospects.workspaceId, user.workspaceId)).orderBy(desc(prospectActivities.occurredAt)) : [];
  const header = ["Business", "Contact", "Email", "Phone", "WhatsApp", "Website", "Social", "Industry", "Location", "Source", "Stage", "Verification", "Owner", "Pitched services", "Estimated value (PHP)", "Channels used", "Touchpoints", "First contact", "Last contact", "Next follow-up", "Latest response", "Declined at", "Declined reason", "Notes", "Activity log"];
  const lines = [header.map(cell).join(",")];
  for (const row of rows) {
    const items = activities.filter((item) => item.activity.prospectId === row.prospect.id);
    const latestResponse = items.find((item) => item.activity.response)?.activity.response ?? "";
    const log = items.map((item) => `${item.activity.occurredAt.toISOString().slice(0, 16).replace("T", " ")} · ${item.activity.channel} · ${item.activity.type} · ${item.activity.outcome}${item.activity.pitched.length ? ` · pitched: ${item.activity.pitched.join("/")}` : ""}${item.activity.response ? ` · "${item.activity.response}"` : ""} (${item.userName ?? "team"})`).join(" | ");
    lines.push([row.prospect.businessName, row.prospect.contactName, row.prospect.email, row.prospect.phone, row.prospect.whatsapp, row.prospect.website, row.prospect.socialLinks, row.prospect.industry, row.prospect.location, row.prospect.source, row.prospect.stage, row.prospect.verification, row.ownerName ?? "", row.prospect.pitchedServices.join("; "), (row.prospect.estimatedValueMinor / 100).toFixed(2), [...new Set(items.map((item) => item.activity.channel))].join("; "), items.length, items.at(-1)?.activity.occurredAt ?? "", row.prospect.lastContactAt ?? "", row.prospect.nextFollowUpAt ?? "", latestResponse, row.prospect.declinedAt ?? "", row.prospect.declinedReason, row.prospect.notes, log].map(cell).join(","));
  }
  await audit(user, "prospect.exported", "prospect", null, { rows: rows.length });
  const filename = `merqato-prospects-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(`\uFEFF${lines.join("\r\n")}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" } });
}
