import { and, desc, eq, inArray, lt, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { agentJobs, incidents, integrations, invoices, projects, tasks } from "@/db/schema";

/**
 * Daily brief.
 *
 * The first thing on the Overview: what is broken, what is late, and what needs a
 * decision today. Everything here is derived from records the workspace already
 * holds, so the brief cannot drift from the underlying system.
 *
 * No secrets are read. Only titles, identifiers, counts and statuses.
 */

export type BriefSeverity = "critical" | "warning" | "info";

export type BriefItem = {
  label: string;
  detail: string;
  href: string;
  severity: BriefSeverity;
};

export type BriefGroup = {
  key: string;
  title: string;
  items: BriefItem[];
};

export type DailyBrief = {
  generatedAt: string;
  groups: BriefGroup[];
  counts: { critical: number; warning: number; info: number };
  clear: boolean;
};

export type BriefAccess = {
  agent: boolean;
  projects: boolean;
  tasks: boolean;
  finance: boolean;
  integrations: boolean;
  operations: boolean;
};

const today = () => new Date().toISOString().slice(0, 10);

const since = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

const money = (minor: number, currency: string) => {
  const value = (minor || 0) / 100;
  try {
    return new Intl.NumberFormat("en-PH", { style: "currency", currency: currency || "PHP", maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency || "PHP"} ${value.toFixed(0)}`;
  }
};

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** Agent queue: failures and jobs waiting for a human decision come first. */
async function agentGroup(workspaceId: string): Promise<BriefGroup | null> {
  const rows = await db
    .select({ id: agentJobs.id, title: agentJobs.title, status: agentJobs.status, error: agentJobs.error, finishedAt: agentJobs.finishedAt })
    .from(agentJobs)
    .where(and(eq(agentJobs.workspaceId, workspaceId), inArray(agentJobs.status, ["failed", "awaiting_approval", "queued", "running"])))
    .orderBy(desc(agentJobs.updatedAt))
    .limit(20);

  const items: BriefItem[] = [];
  const failed = rows.filter((row) => row.status === "failed");
  const awaiting = rows.filter((row) => row.status === "awaiting_approval");
  const active = rows.filter((row) => row.status === "queued" || row.status === "running");

  if (failed.length) {
    items.push({
      label: plural(failed.length, "agent job") + " failed",
      detail: failed[0].error ? `${failed[0].title} — ${failed[0].error.slice(0, 120)}` : failed[0].title,
      href: "/agent",
      severity: "critical",
    });
  }
  if (awaiting.length) {
    items.push({
      label: plural(awaiting.length, "job") + " awaiting approval",
      detail: awaiting.map((row) => row.title).slice(0, 2).join(" · "),
      href: "/agent",
      severity: "warning",
    });
  }
  if (active.length) {
    items.push({
      label: plural(active.length, "job") + " in the queue",
      detail: active.map((row) => row.title).slice(0, 2).join(" · "),
      href: "/agent",
      severity: "info",
    });
  }
  return items.length ? { key: "agent", title: "Agent queue", items } : null;
}

/** Delivery: projects and tasks past their due date. */
async function deliveryGroup(workspaceId: string): Promise<BriefGroup | null> {
  const now = today();
  const [projectRows, taskRows] = await Promise.all([
    db
      .select({ id: projects.id, name: projects.name, dueDate: projects.dueDate, status: projects.status })
      .from(projects)
      .where(and(eq(projects.workspaceId, workspaceId), notInArray(projects.status, ["complete"]), lt(projects.dueDate, now)))
      .orderBy(projects.dueDate)
      .limit(10),
    db
      .select({ id: tasks.id, title: tasks.title, dueDate: tasks.dueDate, projectId: tasks.projectId })
      .from(tasks)
      .where(and(notInArray(tasks.status, ["done"]), lt(tasks.dueDate, now)))
      .orderBy(tasks.dueDate)
      .limit(30),
  ]);

  const items: BriefItem[] = [];
  if (projectRows.length) {
    const worst = projectRows[0];
    items.push({
      label: plural(projectRows.length, "project") + " overdue",
      detail: `${worst.name} was due ${worst.dueDate}`,
      href: "/projects",
      severity: "critical",
    });
  }
  if (taskRows.length) {
    items.push({
      label: plural(taskRows.length, "task") + " overdue",
      detail: `${taskRows[0].title} was due ${taskRows[0].dueDate}`,
      href: "/operations",
      severity: taskRows.length > 5 ? "critical" : "warning",
    });
  }
  return items.length ? { key: "delivery", title: "Delivery", items } : null;
}

/** Money: unpaid invoices past their due date. */
async function moneyGroup(workspaceId: string): Promise<BriefGroup | null> {
  const rows = await db
    .select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber, totalMinor: invoices.totalMinor, currency: invoices.currency, dueDate: invoices.dueDate })
    .from(invoices)
    .where(
      and(
        eq(invoices.workspaceId, workspaceId),
        notInArray(invoices.status, ["paid", "cancelled", "draft"]),
        lt(invoices.dueDate, today()),
      ),
    )
    .orderBy(invoices.dueDate)
    .limit(10);

  if (!rows.length) return null;
  const outstanding = rows.reduce((sum, row) => sum + row.totalMinor, 0);
  const currency = rows[0].currency || "PHP";
  return {
    key: "money",
    title: "Money",
    items: [
      {
        label: plural(rows.length, "invoice") + " overdue",
        detail: `${money(outstanding, currency)} outstanding · oldest due ${rows[0].dueDate}`,
        href: "/finance",
        severity: "critical",
      },
    ],
  };
}

/** Systems: disconnected integrations and open incidents. */
async function systemsGroup(workspaceId: string): Promise<BriefGroup | null> {
  const [integrationRows, incidentRows] = await Promise.all([
    db
      .select({ id: integrations.id, name: integrations.name, key: integrations.key, status: integrations.status })
      .from(integrations)
      .where(and(eq(integrations.workspaceId, workspaceId), inArray(integrations.status, ["error", "expired"])))
      .limit(10),
    db
      .select({ id: incidents.id, title: incidents.title, severity: incidents.severity })
      .from(incidents)
      .where(and(eq(incidents.workspaceId, workspaceId), eq(incidents.status, "open")))
      .limit(10),
  ]);

  const items: BriefItem[] = [];
  if (incidentRows.length) {
    items.push({
      label: plural(incidentRows.length, "open incident"),
      detail: incidentRows.map((row) => row.title).slice(0, 2).join(" · "),
      href: "/operations",
      severity: incidentRows.some((row) => row.severity === "high" || row.severity === "critical") ? "critical" : "warning",
    });
  }
  if (integrationRows.length) {
    items.push({
      label: plural(integrationRows.length, "integration") + " need reconnecting",
      detail: integrationRows.map((row) => row.name).slice(0, 3).join(" · "),
      href: "/admin/integrations",
      severity: "warning",
    });
  }
  return items.length ? { key: "systems", title: "Systems", items } : null;
}

export async function getDailyBrief(workspaceId: string, access: BriefAccess): Promise<DailyBrief> {
  const groups = (
    await Promise.all([
      access.agent ? agentGroup(workspaceId) : null,
      access.projects || access.tasks ? deliveryGroup(workspaceId) : null,
      access.finance ? moneyGroup(workspaceId) : null,
      access.integrations || access.operations ? systemsGroup(workspaceId) : null,
    ])
  ).filter((group): group is BriefGroup => Boolean(group && group.items.length));

  const all = groups.flatMap((group) => group.items);
  const counts = {
    critical: all.filter((item) => item.severity === "critical").length,
    warning: all.filter((item) => item.severity === "warning").length,
    info: all.filter((item) => item.severity === "info").length,
  };

  return { generatedAt: new Date().toISOString(), groups, counts, clear: all.length === 0 };
}
