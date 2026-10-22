import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { clients, expenses, incidents, invoices, projects, services, subscriptions, tasks, users, websites } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { hasPermission, type SessionUser } from "@/lib/permissions";

export const dynamic = "force-dynamic";
const nullableDate = z.preprocess((value) => value === "" || value === undefined ? null : value, z.string().max(40).nullable().optional());
const nullableId = z.preprocess((value) => value === "" || value === undefined ? null : value, z.string().uuid().nullable().optional());
const optionalText = z.string().max(5000).optional();
const schemas: Record<string, z.ZodTypeAny> = {
  clients: z.object({ name: z.string().trim().min(2).max(160), industry: z.string().max(120).default(""), location: z.string().max(160).default(""), status: z.enum(["lead", "active", "paused", "archived"]).default("active"), contactName: z.string().max(160).default(""), email: z.string().max(200).default(""), phone: z.string().max(80).default(""), servicePlan: z.string().max(200).default(""), health: z.enum(["new", "good", "watch", "risk"]).default("good"), notes: z.string().max(10000).default(""), ownerId: nullableId, links: z.array(z.object({ label: z.string().max(100), url: z.string().url().max(1000) })).max(30).default([]) }),
  projects: z.object({ clientId: nullableId, leadId: nullableId, name: z.string().trim().min(2).max(180), code: z.string().trim().min(2).max(30), description: z.string().max(10000).default(""), status: z.enum(["active", "review", "paused", "complete"]).default("active"), priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"), progress: z.number().int().min(0).max(100).default(0), startDate: nullableDate, dueDate: nullableDate, deliverables: z.array(z.string().max(300)).max(50).default([]), repositoryUrl: z.string().max(1000).nullable().optional(), budgetMinor: z.number().int().min(0).default(0), currency: z.string().length(3).default("PHP") }),
  tasks: z.object({ projectId: z.string().uuid(), assigneeId: nullableId, title: z.string().trim().min(2).max(240), description: z.string().max(10000).default(""), status: z.enum(["backlog", "todo", "in_progress", "review", "done"]).default("todo"), priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"), dueDate: nullableDate, estimateHours: z.string().max(10).default("0") }),
  websites: z.object({ clientId: nullableId, projectId: nullableId, name: z.string().trim().min(2).max(180), domain: z.string().trim().min(3).max(255), productionUrl: z.string().url().max(1000), previewUrl: z.string().url().max(1000).nullable().optional(), repositoryUrl: z.string().url().max(1000).nullable().optional(), hostingProvider: z.string().max(160).default(""), status: z.enum(["unknown", "development", "review", "operational", "degraded", "maintenance", "offline"]).default("unknown"), sslExpiry: nullableDate, notes: optionalText.default("") }),
  services: z.object({ name: z.string().trim().min(2).max(180), category: z.string().max(160), description: z.string().max(10000), setupFeeMinor: z.number().int().min(0).default(0), recurringFeeMinor: z.number().int().min(0).default(0), billingCycle: z.enum(["one-time", "monthly", "yearly"]).default("monthly"), thirdPartyCostMinor: z.number().int().min(0).default(0), internalCostMinor: z.number().int().min(0).default(0), currency: z.string().length(3).default("PHP"), pricingNotes: z.string().max(10000).default(""), active: z.boolean().default(true) }),
  invoices: z.object({ clientId: nullableId, invoiceNumber: z.string().trim().min(2).max(80), status: z.enum(["draft", "sent", "partially_paid", "paid", "overdue", "cancelled"]).default("draft"), issueDate: z.string().max(10), dueDate: z.string().max(10), paidAt: nullableDate, currency: z.string().length(3).default("PHP"), subtotalMinor: z.number().int().min(0).default(0), taxMinor: z.number().int().min(0).default(0), totalMinor: z.number().int().min(0).default(0), amountPaidMinor: z.number().int().min(0).default(0), source: z.string().max(50).default("manual"), externalRef: z.string().max(200).nullable().optional() }),
  subscriptions: z.object({ clientId: z.string().uuid(), serviceId: nullableId, name: z.string().trim().min(2).max(180), status: z.enum(["pending", "active", "paused", "cancelled"]).default("active"), amountMinor: z.number().int().min(0).default(0), currency: z.string().length(3).default("PHP"), billingCycle: z.enum(["monthly", "yearly"]).default("monthly"), renewalDate: nullableDate }),
  expenses: z.object({ clientId: nullableId, projectId: nullableId, category: z.string().max(120), vendor: z.string().max(160).default(""), description: z.string().max(1000), amountMinor: z.number().int().min(0), currency: z.string().length(3).default("PHP"), billingCycle: z.enum(["one-time", "monthly", "yearly", "usage-based"]).default("one-time"), paymentMethod: z.string().max(120).default(""), status: z.enum(["paid", "pending", "overdue", "refunded"]).default("paid"), incurredAt: z.string().max(10), nextRenewalAt: nullableDate, receiptUrl: z.preprocess((value) => value === "" ? null : value, z.string().url().max(1000).nullable().optional()), notes: z.string().max(5000).default("") }),
  incidents: z.object({ websiteId: nullableId, title: z.string().trim().min(2).max(240), description: z.string().max(10000).default(""), severity: z.enum(["low", "medium", "high", "critical"]).default("medium"), status: z.enum(["open", "investigating", "mitigated", "resolved"]).default("open"), resolvedAt: nullableDate }),
};

const tables: Record<string, any> = { clients, projects, tasks, websites, services, invoices, subscriptions, expenses, incidents };
const modulePermission: Record<string, string> = { clients: "clients", projects: "projects", tasks: "tasks", websites: "websites", services: "services", invoices: "finance", subscriptions: "finance", expenses: "finance", incidents: "operations" };

async function rowsFor(resource: string, user: SessionUser) {
  if (resource === "tasks") {
    const rows = await db.select({ record: tasks, projectName: projects.name, assigneeName: users.name }).from(tasks).innerJoin(projects, eq(projects.id, tasks.projectId)).leftJoin(users, eq(users.id, tasks.assigneeId)).where(eq(projects.workspaceId, user.workspaceId)).orderBy(desc(tasks.updatedAt));
    return rows.map((row) => ({ ...row.record, projectName: row.projectName, assigneeName: row.assigneeName }));
  }
  if (resource === "subscriptions") {
    const rows = await db.select({ record: subscriptions, clientName: clients.name, serviceName: services.name }).from(subscriptions).innerJoin(clients, eq(clients.id, subscriptions.clientId)).leftJoin(services, eq(services.id, subscriptions.serviceId)).where(eq(clients.workspaceId, user.workspaceId)).orderBy(desc(subscriptions.updatedAt));
    return rows.map((row) => ({ ...row.record, clientName: row.clientName, serviceName: row.serviceName }));
  }
  return db.select().from(tables[resource]).where(eq(tables[resource].workspaceId, user.workspaceId)).orderBy(desc(tables[resource].updatedAt));
}

async function validateReferences(resource: string, data: Record<string, unknown>, user: SessionUser) {
  const checks = [
    { key: "clientId", table: clients },
    { key: "projectId", table: projects },
    { key: "ownerId", table: users },
    { key: "leadId", table: users },
    { key: "assigneeId", table: users },
    { key: "serviceId", table: services },
  ] as const;
  for (const check of checks) {
    const value = data[check.key];
    if (typeof value !== "string" || !value) continue;
    const [record] = await db.select({ id: check.table.id }).from(check.table).where(and(eq(check.table.id, value), eq(check.table.workspaceId, user.workspaceId))).limit(1);
    if (!record) throw new Error(`${check.key} does not belong to this workspace.`);
  }
  if (resource === "incidents" && typeof data.websiteId === "string") {
    const [record] = await db.select({ id: websites.id }).from(websites).where(and(eq(websites.id, data.websiteId), eq(websites.workspaceId, user.workspaceId))).limit(1);
    if (!record) throw new Error("websiteId does not belong to this workspace.");
  }
}

export async function GET(_: Request, { params }: { params: Promise<{ resource: string }> }) {
  const resource = (await params).resource;
  const permission = modulePermission[resource];
  if (!permission || !schemas[resource]) return Response.json({ error: "Unknown resource." }, { status: 404 });
  const { user, response } = await apiUser(`${permission}.view`);
  if (response) return response;
  return Response.json({ records: await rowsFor(resource, user) });
}

export async function POST(request: Request, { params }: { params: Promise<{ resource: string }> }) {
  const resource = (await params).resource;
  const permission = modulePermission[resource];
  if (!permission || !schemas[resource]) return Response.json({ error: "Unknown resource." }, { status: 404 });
  const { user, response } = await apiUser(`${permission}.manage`);
  if (response) return response;
  const parsed = schemas[resource].safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Validation failed. Check required fields, URLs, dates and numeric values.", issues: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })) }, { status: 400 });
  try {
    const data = parsed.data as Record<string, unknown>;
    await validateReferences(resource, data, user);
    const values = ["tasks", "subscriptions"].includes(resource) ? data : { ...data, workspaceId: user.workspaceId };
    const inserted = await db.insert(tables[resource]).values(values).returning() as any[];
    const record = inserted[0];
    await audit(user, `${resource}.created`, resource.slice(0, -1), record.id, { name: record.name || record.title || record.invoiceNumber || record.id });
    return Response.json({ record }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Record could not be created." }, { status: 400 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ resource: string }> }) {
  const resource = (await params).resource;
  const permission = modulePermission[resource];
  if (!permission || !schemas[resource]) return Response.json({ error: "Unknown resource." }, { status: 404 });
  const { user, response } = await apiUser(`${permission}.manage`);
  if (response) return response;
  const body = await request.json() as { id?: string; data?: unknown };
  if (!body.id) return Response.json({ error: "Record ID is required." }, { status: 400 });
  const existing = (await rowsFor(resource, user)).find((record) => record.id === body.id);
  if (!existing) return Response.json({ error: "Record not found in this workspace." }, { status: 404 });
  const parsed = (schemas[resource] as z.ZodObject<any>).partial().safeParse(body.data);
  if (!parsed.success) return Response.json({ error: "Validation failed.", issues: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })) }, { status: 400 });
  try {
    const data = parsed.data as Record<string, unknown>;
    await validateReferences(resource, data, user);
    if (resource === "tasks" && data.status === "done") data.completedAt = new Date();
    if (resource === "incidents" && data.status === "resolved" && !data.resolvedAt) data.resolvedAt = new Date();
    const updated = await db.update(tables[resource]).set({ ...data, updatedAt: new Date() }).where(eq(tables[resource].id, body.id)).returning() as any[];
    const record = updated[0];
    await audit(user, `${resource}.updated`, resource.slice(0, -1), body.id, { fields: Object.keys(data) });
    return Response.json({ record });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Record could not be updated." }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ resource: string }> }) {
  const resource = (await params).resource;
  const permission = modulePermission[resource];
  if (!permission || !schemas[resource]) return Response.json({ error: "Unknown resource." }, { status: 404 });
  const { user, response } = await apiUser(`${permission}.manage`);
  if (response) return response;
  if (!hasPermission(user, `${permission}.manage`)) return Response.json({ error: "Not permitted." }, { status: 403 });
  const body = await request.json() as { id?: string; confirm?: boolean };
  if (!body.id || !body.confirm) return Response.json({ error: "Explicit deletion confirmation is required." }, { status: 400 });
  const existing = (await rowsFor(resource, user)).find((record) => record.id === body.id);
  if (!existing) return Response.json({ error: "Record not found in this workspace." }, { status: 404 });
  await db.delete(tables[resource]).where(eq(tables[resource].id, body.id));
  await audit(user, `${resource}.deleted`, resource.slice(0, -1), body.id);
  return Response.json({ ok: true });
}
