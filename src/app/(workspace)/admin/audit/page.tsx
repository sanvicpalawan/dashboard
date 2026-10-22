import { and, desc, eq, ilike } from "drizzle-orm";
import { AlertTriangle, CheckCircle2, KeyRound, ShieldCheck } from "lucide-react";
import { db } from "@/db";
import { appSettings, auditEvents, backgroundJobs, integrations, roles, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { formatDate, relativeTime } from "@/lib/utils";
export const dynamic = "force-dynamic";
export const metadata = { title: "Security & audit" };
export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser("audit.view");
  const { q } = await searchParams;
  const filters = [eq(auditEvents.workspaceId, user.workspaceId)];
  if (q) filters.push(ilike(auditEvents.action, `%${q.replaceAll("%", "")}%`));
  const [events, setting, integrationRows, superAdminRows, backupRows] = await Promise.all([
    db.select({ event: auditEvents, actor: users.name, email: users.email }).from(auditEvents).leftJoin(users, eq(users.id, auditEvents.userId)).where(and(...filters)).orderBy(desc(auditEvents.createdAt)).limit(200),
    db.select().from(appSettings).where(eq(appSettings.key, `workspace:${user.workspaceId}`)).limit(1).then((rows) => rows[0]),
    db.select().from(integrations).where(eq(integrations.workspaceId, user.workspaceId)),
    db.select({ id: users.id }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(and(eq(users.workspaceId, user.workspaceId), eq(roles.slug, "super-admin"), eq(users.status, "active"))),
    db.select().from(backgroundJobs).where(and(eq(backgroundJobs.workspaceId, user.workspaceId), eq(backgroundJobs.type, "backup.verify"))).orderBy(desc(backgroundJobs.createdAt)).limit(1),
  ]);
  const config = setting?.value as any;
  const latestBackup = backupRows[0];
  const checks = [
    { label: "Credential encryption key", ok: Boolean(process.env.CREDENTIAL_ENCRYPTION_KEY || process.env.AUTH_SECRET), detail: process.env.CREDENTIAL_ENCRYPTION_KEY || process.env.AUTH_SECRET ? "A non-demo server encryption secret is configured." : "Local demo fallback is in use; set CREDENTIAL_ENCRYPTION_KEY for production." },
    { label: "Active Super Administrator", ok: superAdminRows.length > 0, detail: `${superAdminRows.length} active account(s) retain global recovery access.` },
    { label: "Session lifetime policy", ok: Number(config?.sessionHours || 12) <= 24, detail: `${config?.sessionHours || 12} hours; database tokens are hashed and revocable.` },
    { label: "Demo data boundary", ok: !user.demoMode, detail: user.demoMode ? "Demo mode is visibly enabled; disable it for production." : "Demo mode is disabled." },
    { label: "Integration credential errors", ok: !integrationRows.some((item) => item.status === "error"), detail: `${integrationRows.filter((item) => item.status === "error").length} providers in error state; ${integrationRows.filter((item) => item.credentialEncrypted).length} encrypted credentials stored.` },
    { label: "Backup verification record", ok: latestBackup?.status === "success", detail: latestBackup ? `${latestBackup.status} · ${relativeTime(latestBackup.finishedAt || latestBackup.createdAt)}${user.demoMode ? " · demo record" : ""}` : "No backup verification job recorded." },
  ];
  const passed = checks.filter((check) => check.ok).length;
  return <><div className="page-heading"><div className="page-heading-copy"><div className="eyebrow">Append-only accountability</div><h1>Security & audit</h1><p className="page-description">Sensitive actions, access failures and configuration changes—with secret values scrubbed before persistence.</p></div></div>
    <div className="stats-grid"><div className="card stat-card"><div className="label">Security checks passed</div><div className="value">{passed} / {checks.length}</div><div className="detail">Derived from current configuration</div></div><div className="card stat-card"><div className="label">Audit events loaded</div><div className="value">{events.length}</div><div className="detail">Newest 200 maximum</div></div><div className="card stat-card"><div className="label">Authentication failures</div><div className="value">{events.filter((row) => row.event.action === "authentication.failed").length}</div><div className="detail">Within this filtered result set</div></div><div className="card stat-card"><div className="label">Audit retention policy</div><div className="value">{config?.auditRetentionDays || 365}d</div><div className="detail">Configure the retention worker separately</div></div></div>
    <section className="card" style={{ marginBottom: 16 }}><div className="card-header"><ShieldCheck size={15} /><h2>Security configuration checks</h2></div><div className="card-body" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 12 }}>{checks.map((check) => <div key={check.label} style={{ display: "flex", gap: 9 }}>{check.ok ? <CheckCircle2 size={16} color="var(--success)" /> : <AlertTriangle size={16} color="var(--warning)" />}<div><strong style={{ display: "block", fontSize: 11 }}>{check.label}</strong><span style={{ color: "var(--muted)", fontSize: 10 }}>{check.detail}</span></div></div>)}</div></section>
    <section className="card" id="backup" style={{ marginBottom: 16 }}><div className="card-header"><KeyRound size={15} /><h2>Backup, restore & secret rotation</h2></div><div className="card-body"><p className="page-description">Use the documented <span className="code">scripts/backup.sh</span> and <span className="code">scripts/restore.sh</span> with PostgreSQL. Store dumps encrypted off-VPS, test restores into a separate database, and record verification jobs here. Rotate credentials at each provider first, then replace the encrypted value in Integration administration; never put rotated values in audit notes, tickets, logs or dashboard text widgets.</p></div></section>
    <section className="card"><div className="card-header"><h2>Administrative event log</h2><form style={{ marginLeft: "auto" }}><input className="input" name="q" defaultValue={q || ""} placeholder="Filter by action…" style={{ width: 220 }} /></form></div>{events.length ? <div className="audit-list">{events.map((row) => <details className="audit-event" key={row.event.id} style={{ display: "grid" }}><summary style={{ cursor: "pointer" }}><strong>{row.event.action.replaceAll(".", " · ")}</strong></summary><span>{row.actor || "System"}<small style={{ display: "block" }}>{row.email || row.event.entityType}</small></span><span>{row.event.entityType}<small style={{ display: "block" }}>{row.event.entityId || "No entity ID"}</small></span><time title={formatDate(row.event.createdAt)}>{relativeTime(row.event.createdAt)}</time><pre style={{ gridColumn: "1 / -1", maxWidth: "100%", overflow: "auto", padding: 10, borderRadius: 7, background: "var(--surface)", color: "var(--muted)", fontSize: 9 }}>{JSON.stringify(row.event.metadata, null, 2)}</pre></details>)}</div> : <div className="empty-state"><ShieldCheck size={24} /><strong>No audit events match</strong><p>Clear the action filter or perform an audited administrative action.</p></div>}</section>
  </>;
}
