import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  appSettings,
  auditEvents,
  automationRuns,
  backgroundJobs,
  clients,
  expenses,
  integrationCache,
  integrations,
  invoices,
  projects,
  services,
  subscriptions,
  syncRuns,
  tasks,
  users,
  websites,
} from "@/db/schema";
import type { SessionUser } from "@/lib/permissions";
import { decryptSecret, safeExternalUrl } from "@/lib/security";
import { formatDate, formatMoney, relativeTime } from "@/lib/utils";
import type { WidgetData, WidgetItem } from "@/components/widget-types";

type Settings = Record<string, unknown>;
const text = (value: unknown) => typeof value === "string" ? value : "";
const money = (value: number, currency = "PHP") => formatMoney(value, currency, true);
const source = "Workspace database";
const empty = (message: string): WidgetData => ({ kind: "state", state: "empty", message });
const list = (items: WidgetItem[], extra: Partial<WidgetData> = {}): WidgetData => items.length ? { kind: "list", items, ...extra } : { kind: "state", state: "empty", message: "No records match this view.", ...extra };

async function providerData(user: SessionUser, providers: string[], resources: string[]): Promise<WidgetData> {
  const records = await db.select().from(integrations).where(and(eq(integrations.workspaceId, user.workspaceId), inArray(integrations.key, providers)));
  if (!records.length || records.every((record) => !record.enabled || record.status === "disconnected")) {
    return { kind: "state", state: "disconnected", message: `Connect ${providers.map((key) => key[0].toUpperCase() + key.slice(1)).join(" or ")} and run a synchronization to view provider data.`, source: providers.join(", ") };
  }
  const permitted = records.filter((record) => !record.allowedRoles.length || record.allowedRoles.includes(user.roleSlug) || user.permissions.includes("*"));
  if (records.length && !permitted.length) return { kind: "state", state: "error", message: "Your role does not have access to this integration's data." };
  const ids = permitted.filter((record) => record.enabled).map((record) => record.id);
  const cached = ids.length ? await db.select().from(integrationCache).where(inArray(integrationCache.integrationId, ids)).orderBy(desc(integrationCache.fetchedAt)) : [];
  const relevant = cached.filter((record) => resources.includes(record.resourceKey));
  const items = relevant.flatMap((record) => {
    const payload = record.payload as { items?: WidgetItem[] };
    return Array.isArray(payload.items) ? payload.items : [];
  });
  const latest = relevant[0]?.fetchedAt;
  const failed = records.find((record) => record.status === "error" || record.status === "degraded");
  if (!items.length) {
    return { kind: "state", state: failed ? "error" : "empty", message: failed?.lastError || "No synchronized records yet. Run a manual sync from Integration administration.", source: records.map((record) => record.name).join(" + "), fetchedAt: latest?.toISOString(), stale: Boolean(failed) };
  }
  return { kind: "list", items, source: records.map((record) => record.name).join(" + "), fetchedAt: latest?.toISOString(), stale: Boolean(failed), message: failed ? `Showing cached data. Last provider error: ${failed.lastError}` : undefined };
}

function validLinks(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 30).flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    try {
      const url = new URL(text(item.url));
      if (!["http:", "https:"].includes(url.protocol)) return [];
      return [{ id: `link-${index}`, title: text(item.label).slice(0, 120) || url.hostname, subtitle: url.hostname, url: url.toString() }];
    } catch { return []; }
  });
}

function pathValue(payload: unknown, path: string): unknown {
  if (!path) return payload;
  return path.split(".").reduce<unknown>((value, key) => {
    if (value && typeof value === "object" && key in value) return (value as Record<string, unknown>)[key];
    return undefined;
  }, payload);
}

const remoteMemoryCache = new Map<string, { at: number; payload: unknown }>();
async function approvedRemote(user: SessionUser, settings: Settings) {
  const url = safeExternalUrl(text(settings.url));
  const [setting] = await db.select().from(appSettings).where(eq(appSettings.key, `workspace:${user.workspaceId}`)).limit(1);
  const config = setting?.value as { allowedOutboundHosts?: string[] };
  const allowed = config?.allowedOutboundHosts ?? [];
  if (!allowed.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    throw new Error(`Host ${url.hostname} is not approved. Add it under Admin → Settings → Outbound request allowlist.`);
  }
  const cacheKey = `${user.workspaceId}:${url.toString()}`;
  const cached = remoteMemoryCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 120_000) return cached.payload;
  const headers: Record<string, string> = { Accept: "application/json, application/rss+xml, application/xml, text/xml", "User-Agent": "MerQato-Command-Center/1.0" };
  const credentialIntegration = text(settings.credentialIntegration);
  if (credentialIntegration) {
    const [integration] = await db.select().from(integrations).where(and(eq(integrations.workspaceId, user.workspaceId), eq(integrations.key, credentialIntegration))).limit(1);
    if (!integration?.credentialEncrypted) throw new Error("The selected credential reference is not connected.");
    const providerHosts: Record<string, string> = { github: "api.github.com", vercel: "api.vercel.com", cloudflare: "api.cloudflare.com", openrouter: "openrouter.ai", upcloud: "api.upcloud.com" };
    const expectedHost = integration.baseUrl ? new URL(integration.baseUrl).hostname : providerHosts[integration.key];
    if (!expectedHost || url.hostname !== expectedHost) throw new Error("Credential references can only be sent to the integration's own configured hostname.");
    headers.Authorization = `Bearer ${decryptSecret(integration.credentialEncrypted)}`;
  }
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(8000), redirect: "error", cache: "no-store" });
  if (!response.ok) throw new Error(`Remote endpoint returned HTTP ${response.status}.`);
  const length = Number(response.headers.get("content-length") || 0);
  if (length > 2_000_000) throw new Error("Remote response exceeds the 2 MB widget limit.");
  const body = await response.text();
  if (body.length > 2_000_000) throw new Error("Remote response exceeds the 2 MB widget limit.");
  let payload: unknown;
  if ((response.headers.get("content-type") || "").includes("xml") || body.trimStart().startsWith("<?xml") || body.trimStart().startsWith("<rss")) payload = body;
  else {
    try { payload = JSON.parse(body); } catch { throw new Error("Remote endpoint did not return valid JSON or RSS."); }
  }
  remoteMemoryCache.set(cacheKey, { at: Date.now(), payload });
  return payload;
}

async function customRemote(user: SessionUser, key: string, settings: Settings): Promise<WidgetData> {
  try {
    const payload = await approvedRemote(user, settings);
    if (key === "rss-feed") {
      if (typeof payload !== "string") throw new Error("The endpoint did not return an RSS/XML document.");
      const blocks = [...payload.matchAll(/<item[\s\S]*?<\/item>/gi)].slice(0, 12);
      const clean = (value: string) => value.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim();
      const items = blocks.map((match, index) => {
        const block = match[0];
        const field = (name: string) => clean(block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1] ?? "");
        return { id: `rss-${index}`, title: field("title") || "Untitled feed item", subtitle: field("pubDate") || field("description").slice(0, 120), url: field("link") };
      }).filter((item) => item.title);
      return list(items, { source: safeExternalUrl(text(settings.url)).hostname, fetchedAt: new Date().toISOString() });
    }
    if (key === "api-data-card") {
      const raw = pathValue(payload, text(settings.valuePath));
      if (raw === undefined || raw === null || typeof raw === "object") throw new Error("valuePath did not resolve to a scalar value.");
      const label = pathValue(payload, text(settings.labelPath));
      return { kind: "metric", value: String(raw), label: text(settings.label) || "Mapped API value", secondary: label === undefined ? "Live mapped response" : String(label), source: safeExternalUrl(text(settings.url)).hostname, fetchedAt: new Date().toISOString() };
    }
    const rawItems = pathValue(payload, text(settings.itemsPath));
    if (!Array.isArray(rawItems)) throw new Error("itemsPath must resolve to an array.");
    const items = rawItems.slice(0, 20).map((item, index) => {
      const title = pathValue(item, text(settings.labelPath));
      const secondary = pathValue(item, text(settings.secondaryPath));
      return { id: `json-${index}`, title: title === undefined ? `Item ${index + 1}` : String(title), subtitle: secondary === undefined ? "" : String(secondary) };
    });
    return list(items, { source: safeExternalUrl(text(settings.url)).hostname, fetchedAt: new Date().toISOString() });
  } catch (error) {
    return { kind: "state", state: "error", message: error instanceof Error ? error.message : "Remote widget request failed." };
  }
}

export async function getWidgetData(key: string, user: SessionUser, settings: Settings = {}): Promise<WidgetData> {
  const demo = user.demoMode;
  const providerMap: Record<string, { providers: string[]; resources: string[] }> = {
    "repository-inventory": { providers: ["github"], resources: ["repos"] },
    "recent-commits": { providers: ["github"], resources: ["commits"] },
    "open-issues": { providers: ["github"], resources: ["issues"] },
    "pull-requests": { providers: ["github"], resources: ["pulls"] },
    "branch-activity": { providers: ["github"], resources: ["branches"] },
    "workflow-status": { providers: ["github"], resources: ["workflows"] },
    "release-activity": { providers: ["github"], resources: ["releases"] },
    "open-work": { providers: ["github"], resources: ["issues", "pulls"] },
    "vercel-projects": { providers: ["vercel"], resources: ["projects"] },
    "latest-deployments": { providers: ["vercel", "coolify"], resources: ["deployments", "applications"] },
    "deployment-history": { providers: ["vercel", "coolify"], resources: ["deployments", "applications"] },
    "deployment-references": { providers: ["vercel", "coolify"], resources: ["deployments", "applications"] },
    "deployment-health": { providers: ["vercel", "coolify"], resources: ["deployments", "applications"] },
    "coolify-apps": { providers: ["coolify"], resources: ["applications"] },
    "application-health": { providers: ["coolify"], resources: ["applications"] },
    "vps-resources": { providers: ["upcloud"], resources: ["servers", "metrics"] },
    "opencode-status": { providers: ["opencode"], resources: ["health", "sessions"] },
    "agent-activity": { providers: ["opencode"], resources: ["sessions"] },
    "api-usage": { providers: ["openrouter"], resources: ["account"] },
    "invoiceshelf-records": { providers: ["invoiceshelf"], resources: ["invoices", "customers", "payments"] },
  };
  if (providerMap[key]) {
    const config = providerMap[key];
    return { ...await providerData(user, config.providers, config.resources), demo: false };
  }

  if (["rss-feed", "api-data-card", "json-endpoint"].includes(key)) return customRemote(user, key, settings);
  if (["custom-notes", "notes-links", "development-notes"].includes(key)) {
    const links = validLinks(settings.links);
    const body = text(settings.markdown) || text(settings.text);
    if (!body && !links.length) return empty("Add notes or links in widget settings.");
    return { kind: links.length && !body ? "links" : "notes", text: body, items: links, source: "Administrator-authored widget settings", demo: false };
  }
  if (["bookmarks", "external-links", "status-pages"].includes(key)) {
    const items = validLinks(settings.links);
    return items.length ? { kind: "links", items, demo: false } : empty("No links configured. Open widget settings to add validated destinations.");
  }
  if (key === "documentation-links") {
    const custom = validLinks(settings.links);
    const providers = await db.select().from(integrations).where(eq(integrations.workspaceId, user.workspaceId));
    const items = [...custom, ...providers.map((provider) => ({ id: provider.id, title: `${provider.name} documentation`, subtitle: "Official provider reference", url: provider.docsUrl }))];
    return { kind: "links", items, source: "Curated links and integration registry" };
  }
  if (key === "image-tile") {
    try {
      const url = safeExternalUrl(text(settings.url));
      if (url.protocol !== "https:") throw new Error("Image tiles require HTTPS.");
      return { kind: "image", imageUrl: url.toString(), label: text(settings.alt) || "Configured image", demo: false };
    } catch (error) { return { kind: "state", state: "error", message: error instanceof Error ? error.message : "Invalid image URL." }; }
  }
  if (key === "calendar-embed") {
    try {
      const url = safeExternalUrl(text(settings.url));
      if (url.protocol !== "https:" || url.hostname !== "calendar.google.com") throw new Error("Only public HTTPS Google Calendar embed URLs are enabled by default.");
      return { kind: "embed", embedUrl: url.toString(), label: "Calendar embed", demo: false };
    } catch (error) { return { kind: "state", state: "error", message: error instanceof Error ? error.message : "Invalid calendar URL." }; }
  }

  if (["profit-vs-expenses", "expense-breakdown", "upcoming-renewals"].includes(key)) {
    const expenseRows = (await db.select().from(expenses).where(eq(expenses.workspaceId, user.workspaceId))).filter((expense) => expense.status !== "refunded" && expense.currency === "PHP");
    if (key === "upcoming-renewals") {
      const limit = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      return list(expenseRows.filter((expense) => expense.nextRenewalAt && expense.nextRenewalAt <= limit).sort((a, b) => String(a.nextRenewalAt).localeCompare(String(b.nextRenewalAt))).map((expense) => ({ id: expense.id, title: expense.description, subtitle: `${expense.vendor || expense.category} · ${expense.billingCycle}`, value: money(expense.amountMinor), meta: `Renews ${formatDate(expense.nextRenewalAt)}`, status: expense.status })), { source, demo });
    }
    if (key === "expense-breakdown") {
      const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      const totals = expenseRows.filter((expense) => expense.incurredAt >= since).reduce<Record<string, { total: number; count: number }>>((acc, expense) => { const entry = acc[expense.category] || { total: 0, count: 0 }; entry.total += expense.amountMinor; entry.count += 1; acc[expense.category] = entry; return acc; }, {});
      const grand = Object.values(totals).reduce((sum, entry) => sum + entry.total, 0) || 1;
      return list(Object.entries(totals).sort((a, b) => b[1].total - a[1].total).map(([category, entry]) => ({ id: category, title: category, subtitle: `${entry.count} record${entry.count === 1 ? "" : "s"} · last 90 days`, value: money(entry.total), progress: Math.round(entry.total / grand * 100) })), { source, demo });
    }
    const invoiceRows = (await db.select().from(invoices).where(eq(invoices.workspaceId, user.workspaceId))).filter((invoice) => invoice.currency === "PHP" && invoice.status !== "cancelled");
    const months = Array.from({ length: 6 }, (_, index) => { const date = new Date(); date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() - (5 - index)); return date.toISOString().slice(0, 7); });
    const series = months.map((month) => { const received = invoiceRows.filter((invoice) => invoice.paidAt?.toISOString().startsWith(month)).reduce((sum, invoice) => sum + invoice.amountPaidMinor, 0); const spent = expenseRows.filter((expense) => expense.incurredAt.startsWith(month)).reduce((sum, expense) => sum + expense.amountMinor, 0); return { label: new Date(`${month}-02`).toLocaleDateString("en", { month: "short" }), value: received / 100, secondary: spent / 100 }; });
    const totalReceived = series.reduce((sum, point) => sum + point.value, 0) * 100;
    const totalSpent = series.reduce((sum, point) => sum + (point.secondary ?? 0), 0) * 100;
    return { kind: "series", series, label: `Cash received vs expenses · 6 months · net ${money(totalReceived - totalSpent)} (${money(totalReceived)} in, ${money(totalSpent)} out)`, source, demo };
  }

  if (["revenue-overview", "invoice-status", "invoice-totals", "paid-invoices", "outstanding-invoices", "overdue-payments", "monthly-revenue", "expense-margins"].includes(key)) {
    const invoiceRows = await db.select({ invoice: invoices, clientName: clients.name }).from(invoices).leftJoin(clients, eq(clients.id, invoices.clientId)).where(eq(invoices.workspaceId, user.workspaceId)).orderBy(desc(invoices.issueDate));
    const all = invoiceRows.map((row) => ({ ...row.invoice, clientName: row.clientName }));
    const nonDraft = all.filter((invoice) => invoice.status !== "draft" && invoice.status !== "cancelled");
    const accounting = nonDraft.filter((invoice) => invoice.currency === "PHP");
    const otherCurrencies = [...new Set(nonDraft.map((invoice) => invoice.currency).filter((currency) => currency !== "PHP"))];
    const currencyNote = otherCurrencies.length ? ` · ${otherCurrencies.join(", ")} excluded from PHP aggregates (no FX rate configured)` : "";
    const invoiced = accounting.reduce((sum, invoice) => sum + invoice.totalMinor, 0);
    const received = accounting.reduce((sum, invoice) => sum + invoice.amountPaidMinor, 0);
    const outstanding = accounting.reduce((sum, invoice) => sum + Math.max(0, invoice.totalMinor - invoice.amountPaidMinor), 0);
    const overdue = nonDraft.filter((invoice) => invoice.dueDate < new Date().toISOString().slice(0, 10) && invoice.amountPaidMinor < invoice.totalMinor);
    if (key === "revenue-overview") return { kind: "metric", value: money(invoiced), label: "Invoiced revenue", secondary: `${money(received)} cash received · ${money(outstanding)} outstanding${currencyNote}`, source, demo };
    if (key === "invoice-totals") return { kind: "metric", value: money(invoiced), label: `${accounting.length} issued PHP invoices`, secondary: `Draft and cancelled invoices excluded${currencyNote}`, source, demo };
    if (key === "outstanding-invoices") return { kind: "metric", value: money(outstanding), label: "Outstanding balance", secondary: `${nonDraft.filter((invoice) => invoice.amountPaidMinor < invoice.totalMinor).length} open invoices`, source, demo };
    if (key === "overdue-payments" || key === "invoice-status") return list(overdue.map((invoice) => ({ id: invoice.id, title: invoice.invoiceNumber, subtitle: `${invoice.clientName ?? "Unknown client"} · ${money(invoice.totalMinor - invoice.amountPaidMinor, invoice.currency)}`, meta: `Due ${formatDate(invoice.dueDate)}`, status: "Overdue" })), { source, demo });
    if (key === "paid-invoices") return list(all.filter((invoice) => invoice.amountPaidMinor >= invoice.totalMinor && invoice.totalMinor > 0).map((invoice) => ({ id: invoice.id, title: invoice.invoiceNumber, subtitle: invoice.clientName ?? "Unknown client", value: money(invoice.amountPaidMinor, invoice.currency), meta: formatDate(invoice.paidAt), status: "Paid" })), { source, demo });
    if (key === "monthly-revenue") {
      const months = Array.from({ length: 6 }, (_, index) => { const date = new Date(); date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() - (5 - index)); return date.toISOString().slice(0, 7); });
      const series = months.map((month) => ({ label: new Date(`${month}-02`).toLocaleDateString("en", { month: "short" }), value: accounting.filter((invoice) => invoice.issueDate.startsWith(month)).reduce((sum, invoice) => sum + invoice.totalMinor, 0) / 100, secondary: accounting.filter((invoice) => invoice.paidAt?.toISOString().startsWith(month)).reduce((sum, invoice) => sum + invoice.amountPaidMinor, 0) / 100 }));
      return { kind: "series", series, label: "Invoiced vs cash received · PHP", source, demo };
    }
    const expenseRows = await db.select().from(expenses).where(eq(expenses.workspaceId, user.workspaceId));
    const totalExpenses = expenseRows.filter((expense) => expense.currency === "PHP" && expense.status !== "refunded").reduce((sum, expense) => sum + expense.amountMinor, 0);
    return { kind: "metric", value: money(received - totalExpenses), label: "Estimated profit (cash received − expenses)", secondary: `${money(received)} received · ${money(totalExpenses)} expenses · ${money(invoiced - totalExpenses)} on invoiced basis`, source, demo };
  }

  if (["active-clients", "client-list", "client-details"].includes(key)) {
    const rows = await db.select({ client: clients, ownerName: users.name }).from(clients).leftJoin(users, eq(users.id, clients.ownerId)).where(eq(clients.workspaceId, user.workspaceId)).orderBy(desc(clients.updatedAt));
    if (key === "active-clients") {
      const active = rows.filter((row) => row.client.status === "active");
      return { kind: "metric", value: String(active.length), label: "Active clients", secondary: `${active.filter((row) => row.client.health === "good").length} healthy · ${active.filter((row) => row.client.health === "watch").length} need attention`, source, demo };
    }
    if (key === "client-details") {
      const selected = rows.find((row) => row.client.id === settings.clientId) ?? rows[0];
      if (!selected) return empty("Create a client to populate this widget.");
      return { kind: "notes", text: `${selected.client.contactName}\n${selected.client.email}\n${selected.client.servicePlan}\n\n${selected.client.notes}`, label: `${selected.client.name} · ${selected.client.location}`, items: validLinks(selected.client.links), source, demo };
    }
    return { kind: "table", columns: [{ key: "client", label: "Client" }, { key: "plan", label: "Service plan" }, { key: "owner", label: "Owner" }, { key: "health", label: "Health" }], rows: rows.map((row) => ({ client: row.client.name, plan: row.client.servicePlan, owner: row.ownerName ?? "Unassigned", health: row.client.health })), source, demo };
  }

  if (["active-projects", "project-progress", "repository-links", "project-profitability"].includes(key)) {
    const rows = await db.select({ project: projects, clientName: clients.name, leadName: users.name }).from(projects).leftJoin(clients, eq(clients.id, projects.clientId)).leftJoin(users, eq(users.id, projects.leadId)).where(eq(projects.workspaceId, user.workspaceId)).orderBy(desc(projects.updatedAt));
    if (key === "active-projects") return { kind: "metric", value: String(rows.filter((row) => ["active", "review"].includes(row.project.status)).length), label: "Active projects", secondary: `${rows.filter((row) => row.project.priority === "urgent").length} urgent · ${rows.filter((row) => row.project.status === "review").length} in review`, source, demo };
    if (key === "repository-links") {
      const items = rows.filter((row) => row.project.repositoryUrl).map((row) => ({ id: row.project.id, title: row.project.name, subtitle: row.project.code, url: row.project.repositoryUrl ?? undefined }));
      return items.length ? { kind: "links", items, source, demo } : empty("Add repository URLs to projects to create development mappings.");
    }
    if (key === "project-profitability") {
      const costRows = await db.select().from(expenses).where(eq(expenses.workspaceId, user.workspaceId));
      return { kind: "table", columns: [{ key: "project", label: "Project" }, { key: "budget", label: "Budget" }, { key: "cost", label: "Recorded costs" }, { key: "margin", label: "Estimated margin" }], rows: rows.map((row) => { const cost = costRows.filter((expense) => expense.projectId === row.project.id).reduce((sum, expense) => sum + expense.amountMinor, 0); return { project: row.project.name, budget: row.project.budgetMinor ? money(row.project.budgetMinor) : "Not set", cost: money(cost), margin: row.project.budgetMinor ? money(row.project.budgetMinor - cost) : "Unavailable" }; }), source, demo };
    }
    return list(rows.map((row) => ({ id: row.project.id, title: row.project.name, subtitle: `${row.clientName ?? "Internal"} · ${row.leadName ?? "Unassigned"}`, meta: row.project.dueDate ? `Due ${formatDate(row.project.dueDate)}` : "No due date", status: row.project.status, progress: row.project.progress })), { source, demo });
  }

  if (["tasks-today", "upcoming-deadlines", "task-board", "calendar-deadlines", "team-capacity"].includes(key)) {
    const rows = await db.select({ task: tasks, projectName: projects.name, assigneeName: users.name }).from(tasks).innerJoin(projects, eq(projects.id, tasks.projectId)).leftJoin(users, eq(users.id, tasks.assigneeId)).where(eq(projects.workspaceId, user.workspaceId)).orderBy(desc(tasks.updatedAt));
    const open = rows.filter((row) => row.task.status !== "done");
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
    if (key === "tasks-today") return list(open.filter((row) => row.task.dueDate === today).map((row) => ({ id: row.task.id, title: row.task.title, subtitle: `${row.projectName} · ${row.assigneeName ?? "Unassigned"}`, status: row.task.priority, meta: `${row.task.estimateHours}h estimated` })), { source, demo });
    if (key === "task-board") {
      const lanes = [{ key: "backlog", title: "Backlog" }, { key: "todo", title: "To do" }, { key: "in_progress", title: "In progress" }, { key: "review", title: "Review" }, { key: "done", title: "Done" }];
      return { kind: "board", groups: lanes.map((lane) => ({ title: lane.title, items: rows.filter((row) => row.task.status === lane.key).map((row) => ({ id: row.task.id, title: row.task.title, subtitle: row.projectName, status: row.task.priority, meta: row.task.dueDate ? formatDate(row.task.dueDate, { month: "short", day: "numeric" }) : "No date" })) })), source, demo };
    }
    if (key === "team-capacity") {
      const names = [...new Set(rows.map((row) => row.assigneeName ?? "Unassigned"))];
      return list(names.map((name) => { const assigned = open.filter((row) => (row.assigneeName ?? "Unassigned") === name); return { id: name, title: name, subtitle: `${assigned.length} open tasks`, value: `${assigned.reduce((sum, row) => sum + Number(row.task.estimateHours), 0).toFixed(1)}h`, meta: "Estimated open effort" }; }), { source, demo });
    }
    const projectRows = await db.select().from(projects).where(eq(projects.workspaceId, user.workspaceId));
    const deadlines = [
      ...open.filter((row) => row.task.dueDate).map((row) => ({ id: row.task.id, title: row.task.title, subtitle: `${row.projectName} · Task`, date: row.task.dueDate as string, status: row.task.priority })),
      ...projectRows.filter((project) => project.dueDate && project.status !== "complete").map((project) => ({ id: project.id, title: project.name, subtitle: `${project.code} · Project delivery`, date: project.dueDate as string, status: project.status })),
    ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 12);
    return list(deadlines.map((item) => ({ ...item, meta: formatDate(item.date) })), { source, demo });
  }

  if (["website-count", "client-websites", "preview-links", "uptime-checks", "domain-inventory", "ssl-expiry"].includes(key)) {
    const rows = await db.select({ website: websites, clientName: clients.name }).from(websites).leftJoin(clients, eq(clients.id, websites.clientId)).where(eq(websites.workspaceId, user.workspaceId)).orderBy(desc(websites.updatedAt));
    if (key === "website-count") return { kind: "metric", value: String(rows.length), label: "Managed websites", secondary: `${rows.filter((row) => row.website.status === "operational").length} operational · ${rows.filter((row) => ["degraded", "unknown"].includes(row.website.status)).length} need verification`, source, demo };
    if (key === "client-websites") return { kind: "table", columns: [{ key: "website", label: "Website" }, { key: "client", label: "Client" }, { key: "host", label: "Hosting" }, { key: "status", label: "Recorded state" }], rows: rows.map((row) => ({ website: row.website.domain, client: row.clientName ?? "Unassigned", host: row.website.hostingProvider, status: row.website.status })), source, demo };
    if (key === "preview-links") { const items = rows.flatMap((row) => [{ id: `${row.website.id}-prod`, title: `${row.website.name} · Production`, subtitle: row.website.domain, url: row.website.productionUrl }, ...(row.website.previewUrl ? [{ id: `${row.website.id}-preview`, title: `${row.website.name} · Preview`, subtitle: row.website.hostingProvider, url: row.website.previewUrl }] : [])]); return { kind: "links", items, source, demo }; }
    if (key === "ssl-expiry") return list(rows.filter((row) => row.website.sslExpiry).sort((a, b) => String(a.website.sslExpiry).localeCompare(String(b.website.sslExpiry))).map((row) => ({ id: row.website.id, title: row.website.domain, subtitle: "Inventory-recorded certificate date; verify with provider", meta: formatDate(row.website.sslExpiry), status: row.website.sslExpiry && row.website.sslExpiry < new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) ? "Review soon" : "Recorded" })), { source, demo });
    return list(rows.map((row) => ({ id: row.website.id, title: row.website.domain, subtitle: `${row.clientName ?? "Unassigned"} · ${row.website.hostingProvider}`, meta: `Checked ${relativeTime(row.website.lastCheckedAt)}`, status: row.website.status, url: row.website.productionUrl })), { source, demo });
  }

  if (["recurring-revenue", "client-subscriptions", "service-renewals", "renewal-reminders"].includes(key)) {
    const rows = await db.select({ subscription: subscriptions, clientName: clients.name, serviceName: services.name }).from(subscriptions).innerJoin(clients, eq(clients.id, subscriptions.clientId)).leftJoin(services, eq(services.id, subscriptions.serviceId)).orderBy(desc(subscriptions.updatedAt));
    const active = rows.filter((row) => row.subscription.status === "active");
    if (key === "recurring-revenue") {
      const mrr = active.filter((row) => row.subscription.currency === "PHP").reduce((sum, row) => sum + (row.subscription.billingCycle === "yearly" ? Math.round(row.subscription.amountMinor / 12) : row.subscription.amountMinor), 0);
      return { kind: "metric", value: money(mrr), label: "Monthly recurring revenue", secondary: `${active.length} active subscriptions · separate from invoiced and received revenue`, source, demo };
    }
    const renewalRows = key === "service-renewals" || key === "renewal-reminders" ? rows.filter((row) => row.subscription.renewalDate && row.subscription.renewalDate <= new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10)) : rows;
    return list(renewalRows.map((row) => ({ id: row.subscription.id, title: row.subscription.name, subtitle: `${row.clientName} · ${row.serviceName ?? "Custom service"}`, value: money(row.subscription.amountMinor, row.subscription.currency), meta: `Renews ${formatDate(row.subscription.renewalDate)}`, status: row.subscription.status })), { source, demo });
  }

  if (["automation-failures", "automation-inventory", "workflow-runs", "failed-runs", "queue-status"].includes(key)) {
    if (key === "queue-status") {
      const jobs = await db.select().from(backgroundJobs).where(eq(backgroundJobs.workspaceId, user.workspaceId));
      return { kind: "metric", value: String(jobs.filter((job) => ["queued", "running"].includes(job.status)).length), label: "Jobs in queue", secondary: `${jobs.filter((job) => job.status === "failed").length} failed · ${jobs.filter((job) => job.status === "success").length} completed`, source, demo };
    }
    let runs = await db.select().from(automationRuns).where(eq(automationRuns.workspaceId, user.workspaceId)).orderBy(desc(automationRuns.startedAt));
    if (key === "automation-failures" || key === "failed-runs") runs = runs.filter((run) => run.status === "failed");
    return list(runs.map((run) => ({ id: run.id, title: run.name, subtitle: run.source, meta: `${relativeTime(run.startedAt)}${run.finishedAt ? ` · ${Math.max(1, Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000))}s` : ""}`, status: run.status })), { source, demo });
  }

  if (["recent-activity", "project-activity"].includes(key)) {
    let rows = await db.select({ event: auditEvents, actor: users.name }).from(auditEvents).leftJoin(users, eq(users.id, auditEvents.userId)).where(eq(auditEvents.workspaceId, user.workspaceId)).orderBy(desc(auditEvents.createdAt)).limit(20);
    if (key === "project-activity") rows = rows.filter((row) => ["project", "task", "website", "client"].includes(row.event.entityType));
    return list(rows.map((row) => ({ id: row.event.id, title: row.event.action.replaceAll(".", " · "), subtitle: `${row.actor ?? "System"} · ${row.event.entityType}`, meta: relativeTime(row.event.createdAt) })), { source: "Append-only audit log", demo });
  }

  if (key === "system-health" || key === "service-health") {
    const [integrationRows, failedSyncs, jobs] = await Promise.all([
      db.select().from(integrations).where(eq(integrations.workspaceId, user.workspaceId)),
      db.select().from(syncRuns).innerJoin(integrations, eq(integrations.id, syncRuns.integrationId)).where(and(eq(integrations.workspaceId, user.workspaceId), eq(syncRuns.status, "failed"))),
      db.select().from(backgroundJobs).where(eq(backgroundJobs.workspaceId, user.workspaceId)),
    ]);
    const errors = integrationRows.filter((integration) => integration.status === "error").length;
    const items: WidgetItem[] = [
      { id: "database", title: "PostgreSQL", subtitle: "Query completed for this health view", status: "healthy", meta: "Verified now" },
      { id: "integrations", title: "Integrations", subtitle: `${integrationRows.filter((row) => row.status === "connected").length} connected · ${integrationRows.filter((row) => row.status === "disconnected").length} disconnected`, status: errors ? "error" : "healthy", meta: `${failedSyncs.length} failed sync records` },
      { id: "jobs", title: "Background jobs", subtitle: `${jobs.filter((job) => job.status === "queued").length} queued · ${jobs.filter((job) => job.status === "failed").length} failed`, status: jobs.some((job) => job.status === "failed") ? "degraded" : "healthy", meta: "Database-backed queue" },
    ];
    return { kind: "health", items, source: "Verified application queries", fetchedAt: new Date().toISOString(), demo };
  }

  if (key === "webhook-activity") {
    const { webhookEvents } = await import("@/db/schema");
    const rows = await db.select().from(webhookEvents).where(eq(webhookEvents.workspaceId, user.workspaceId)).orderBy(desc(webhookEvents.receivedAt)).limit(20);
    return list(rows.map((event) => ({ id: event.id, title: `${event.provider} · ${event.eventType}`, subtitle: `${text((event.payloadSummary as Record<string, unknown>).repository) || "Repository not supplied"} · ${text((event.payloadSummary as Record<string, unknown>).action) || "No action"}`, meta: relativeTime(event.receivedAt), status: event.status })), { source: "Signed webhook receiver", demo: false });
  }
  if (key === "model-provider-links" || key === "opencode-links") {
    const configured = await db.select().from(integrations).where(and(eq(integrations.workspaceId, user.workspaceId), inArray(integrations.key, key === "opencode-links" ? ["opencode", "github"] : ["openrouter", "ollama"])));
    const items = configured.map((integration) => ({ id: integration.id, title: integration.name, subtitle: integration.baseUrl || (integration.status === "disconnected" ? "Not connected · open integration settings" : integration.status), url: integration.baseUrl || integration.docsUrl }));
    return { kind: "links", items, source: "Integration configuration" };
  }
  return empty("This registered widget has no data contract handler. Disable it or install the matching server adapter.");
}
