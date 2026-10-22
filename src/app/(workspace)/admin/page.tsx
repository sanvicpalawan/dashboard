import Link from "next/link";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Database, ShieldAlert } from "lucide-react";
import { and, count, desc, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, backgroundJobs, dashboards, integrations, roles, sessions, syncRuns, teams, users, widgetDefinitions, workspaces } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { relativeTime } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Administration" };
export default async function AdminOverview() {
  const user = await requireUser("admin.access");
  const [userCount, activeSessions, teamCount, workspaceCount, dashboardCount, widgetCount, teamRows, integrationRows, jobRows, failedSyncs, auditRows, roleRows] = await Promise.all([
    db.select({ value: count() }).from(users).where(eq(users.workspaceId, user.workspaceId)),
    db.select({ value: count() }).from(sessions).innerJoin(users, eq(users.id, sessions.userId)).where(and(eq(users.workspaceId, user.workspaceId), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date()))),
    db.select({ value: count() }).from(teams).where(eq(teams.workspaceId, user.workspaceId)),
    db.select({ value: count() }).from(workspaces),
    db.select({ value: count() }).from(dashboards).where(eq(dashboards.workspaceId, user.workspaceId)),
    db.select({ value: count() }).from(widgetDefinitions).where(eq(widgetDefinitions.installed, true)),
    db.select().from(teams).where(eq(teams.workspaceId, user.workspaceId)),
    db.select().from(integrations).where(eq(integrations.workspaceId, user.workspaceId)),
    db.select().from(backgroundJobs).where(eq(backgroundJobs.workspaceId, user.workspaceId)),
    db.select({ run: syncRuns, provider: integrations.name }).from(syncRuns).innerJoin(integrations, eq(integrations.id, syncRuns.integrationId)).where(and(eq(integrations.workspaceId, user.workspaceId), eq(syncRuns.status, "failed"))).orderBy(desc(syncRuns.startedAt)).limit(5),
    db.select({ event: auditEvents, actor: users.name }).from(auditEvents).leftJoin(users, eq(users.id, auditEvents.userId)).where(eq(auditEvents.workspaceId, user.workspaceId)).orderBy(desc(auditEvents.createdAt)).limit(8),
    db.select().from(roles),
  ]);
  const connected = integrationRows.filter((item) => item.status === "connected").length;
  const errors = integrationRows.filter((item) => item.status === "error").length;
  const failedJobs = jobRows.filter((item) => item.status === "failed").length;
  const issues = [
    ...(user.demoMode ? [{ title: "Demo mode is enabled", detail: "Fictional business records are present. Set DEMO_MODE=false before production bootstrap.", href: "/admin/settings", severity: "review" }] : []),
    ...(!process.env.CREDENTIAL_ENCRYPTION_KEY && !process.env.AUTH_SECRET ? [{ title: "Credential encryption uses the local demo fallback", detail: "Set a strong CREDENTIAL_ENCRYPTION_KEY before connecting production providers.", href: "/admin/settings", severity: "high" }] : []),
    ...(connected === 0 ? [{ title: "No external provider is connected", detail: "Provider-backed widgets intentionally show disconnected states.", href: "/admin/integrations", severity: "setup" }] : []),
    ...(errors ? [{ title: `${errors} integration${errors === 1 ? " has" : "s have"} connection errors`, detail: "Inspect provider errors, credential scopes and synchronization history.", href: "/admin/integrations", severity: "high" }] : []),
    ...(failedJobs ? [{ title: `${failedJobs} background job${failedJobs === 1 ? " requires" : "s require"} inspection`, detail: "Failed jobs remain visible; configure the related service before retrying.", href: "/operations", severity: "review" }] : []),
  ];
  const stats = [
    { label: "Users & active sessions", value: `${userCount[0].value} / ${activeSessions[0].value}`, detail: "Active, unexpired database sessions" },
    { label: "Teams & workspaces", value: `${teamCount[0].value} / ${workspaceCount[0].value}`, detail: `${roleRows.length} configurable roles` },
    { label: "Dashboards & widgets", value: `${dashboardCount[0].value} / ${widgetCount[0].value}`, detail: "Configured dashboards / installed definitions" },
    { label: "Connected integrations", value: `${connected} / ${integrationRows.length}`, detail: `${errors} errors · ${failedSyncs.length} recent sync failures` },
  ];
  return <><div className="page-heading"><div className="page-heading-copy"><div className="eyebrow">Supervision & control</div><h1>Administration</h1><p className="page-description">Actual workspace configuration, security posture and operational health for MerQato Command Center.</p></div><div className="heading-actions"><Link className="button" href="/api/health" target="_blank">Health JSON <ArrowUpRight size={13} /></Link></div></div>
    <div className="stats-grid">{stats.map((stat) => <div className="card stat-card" key={stat.label}><div className="label">{stat.label}</div><div className="value">{stat.value}</div><div className="detail">{stat.detail}</div></div>)}</div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 14, marginBottom: 14 }}>
      <section className="card"><div className="card-header"><Database size={15} /><h2>Application health</h2></div><div className="card-body widget-list">
        <div className="widget-item"><div className="widget-item-main"><span className="widget-item-title">PostgreSQL</span><span className="widget-item-sub">Administrative aggregate queries completed successfully</span></div><span className="badge badge-healthy">Connected</span></div>
        <div className="widget-item"><div className="widget-item-main"><span className="widget-item-title">Background queue</span><span className="widget-item-sub">{jobRows.filter((job) => job.status === "queued").length} queued · {jobRows.filter((job) => job.status === "running").length} running</span></div><span className={`badge ${failedJobs ? "badge-degraded" : "badge-healthy"}`}>{failedJobs ? `${failedJobs} failed` : "Healthy"}</span></div>
        <div className="widget-item"><div className="widget-item-main"><span className="widget-item-title">Application version</span><span className="widget-item-sub">Process uptime {Math.floor(process.uptime() / 60)} minutes · Next.js App Router</span></div><span className="badge">v1.0.0</span></div>
        <div className="widget-item"><div className="widget-item-main"><span className="widget-item-title">Teams</span><span className="widget-item-sub">{teamRows.map((team) => team.name).join(" · ") || "No teams configured"}</span></div></div>
      </div></section>
      <section className="card"><div className="card-header"><ShieldAlert size={15} /><h2>Pending configuration & security</h2><span className="badge" style={{ marginLeft: "auto" }}>{issues.length}</span></div><div className="card-body" style={{ paddingTop: 8 }}>{issues.length ? issues.map((issue) => <Link href={issue.href} key={issue.title} style={{ display: "flex", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--border)" }}><AlertTriangle size={14} color={issue.severity === "high" ? "var(--danger)" : "var(--warning)"} style={{ flex: "0 0 auto", marginTop: 2 }} /><span><strong style={{ display: "block", fontSize: 11, fontWeight: 550 }}>{issue.title}</strong><span style={{ display: "block", color: "var(--muted)", fontSize: 10, marginTop: 3 }}>{issue.detail}</span></span></Link>) : <div className="empty-state"><CheckCircle2 size={24} /><strong>No pending checks</strong><p>Current configuration checks did not identify an issue.</p></div>}</div></section>
    </div>
    <section className="card" style={{ marginBottom: 14 }}><div className="card-header"><h2>Integrations</h2><span className="badge" style={{ marginLeft: 8 }}>{connected} connected · {integrationRows.length - connected} disconnected</span><Link href="/admin/integrations" className="button button-sm button-primary" style={{ marginLeft: "auto" }}>Open integration control <ArrowUpRight size={12} /></Link></div><div className="card-body" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))", gap: 8, paddingTop: 12 }}>{integrationRows.map((integration) => <Link href="/admin/integrations" key={integration.id} className="link-tile" style={{ padding: 10 }}><span className="integration-logo" style={{ width: 28, height: 28, fontSize: 10 }}>{integration.name.slice(0, 2).toUpperCase()}</span><span style={{ minWidth: 0, flex: 1 }}><span style={{ display: "block", color: "var(--text)", fontSize: 11 }}>{integration.name}</span><span className={`badge badge-${integration.status}`} style={{ marginTop: 3 }}>{integration.status}</span></span></Link>)}</div></section>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 14 }}>
      <section className="card"><div className="card-header"><h2>Recent administrative activity</h2><Link href="/admin/audit" className="button button-sm button-ghost" style={{ marginLeft: "auto" }}>Full audit</Link></div><div className="card-body widget-list">{auditRows.map((row) => <div className="widget-item" key={row.event.id}><div className="widget-item-main"><span className="widget-item-title">{row.event.action.replaceAll(".", " · ")}</span><span className="widget-item-sub">{row.actor || "System"} · {row.event.entityType}</span></div><span className="widget-item-meta">{relativeTime(row.event.createdAt)}</span></div>)}</div></section>
      <section className="card"><div className="card-header"><h2>Synchronization failures</h2><Link href="/admin/integrations" className="button button-sm button-ghost" style={{ marginLeft: "auto" }}>Inspect</Link></div><div className="card-body">{failedSyncs.length ? failedSyncs.map((row) => <div key={row.run.id} style={{ padding: "9px 0", borderBottom: "1px solid var(--border)" }}><strong style={{ fontSize: 11 }}>{row.provider}</strong><p style={{ margin: "4px 0", color: "var(--danger)", fontSize: 10 }}>{row.run.error}</p><span style={{ color: "var(--muted)", fontSize: 9 }}>{relativeTime(row.run.startedAt)}</span></div>) : <div className="empty-state"><CheckCircle2 size={22} /><strong>No recorded sync failures</strong><p>Manual and scheduled provider synchronization failures will appear here.</p></div>}</div></section>
    </div></>;
}
