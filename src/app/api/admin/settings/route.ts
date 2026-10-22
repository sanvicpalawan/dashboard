import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { appSettings, workspaces } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
const optionalUrl = z.preprocess((value) => value === "" ? null : value, z.string().url().max(1000).nullable().optional());
const schema = z.object({ applicationName: z.string().trim().min(2).max(100), coBrand: z.string().max(100), brandMark: z.string().trim().min(1).max(4), logoUrl: optionalUrl, faviconUrl: optionalUrl, locale: z.enum(["en-PH", "en-US", "en-GB"]), timezone: z.enum(["Asia/Manila", "UTC", "Asia/Singapore", "Australia/Sydney"]), currency: z.enum(["PHP", "USD", "EUR"]), dateFormat: z.enum(["medium", "short", "long"]), weekStartsOn: z.number().int().min(0).max(1), allowUserThemes: z.boolean(), allowUserLayouts: z.boolean(), auditRetentionDays: z.number().int().min(30).max(3650), sessionHours: z.number().int().min(1).max(168), healthCheckSeconds: z.number().int().min(30).max(3600), syncIntervalMinutes: z.number().int().min(5).max(1440), maintenanceMode: z.boolean(), navigation: z.array(z.string().max(80)).max(30), allowedOutboundHosts: z.array(z.string().regex(/^[a-zA-Z0-9.-]+$/).max(255)).max(100), backupSchedule: z.string().max(100) });
export async function PATCH(request: Request) {
  const { user, response } = await apiUser("settings.manage");
  if (response) return response;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Settings validation failed. Check URLs, hostnames, numeric limits and required branding fields." }, { status: 400 });
  const key = `workspace:${user.workspaceId}`;
  const [setting] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  const previous = setting?.value as Record<string, unknown> || {};
  const value = { ...previous, ...parsed.data, version: "1.0.0" };
  await db.insert(appSettings).values({ key, value, updatedBy: user.id }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: user.id, updatedAt: new Date() } });
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, user.workspaceId)).limit(1);
  await db.update(workspaces).set({ brandMark: parsed.data.brandMark, settings: { ...(workspace.settings as Record<string, unknown>), applicationName: parsed.data.applicationName, coBrand: parsed.data.coBrand, logoUrl: parsed.data.logoUrl, faviconUrl: parsed.data.faviconUrl }, updatedAt: new Date() }).where(eq(workspaces.id, user.workspaceId));
  await audit(user, parsed.data.maintenanceMode !== previous.maintenanceMode ? "security.maintenance_mode_changed" : "settings.updated", "workspace", user.workspaceId, { fields: Object.keys(parsed.data), maintenanceMode: parsed.data.maintenanceMode });
  return Response.json({ ok: true, settings: value });
}
