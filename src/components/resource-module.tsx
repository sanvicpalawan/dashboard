"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Activity, Check, Edit3, ExternalLink, LoaderCircle, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { MODULES, type FieldConfig } from "@/lib/module-config";
import type { WebsiteLiveResponse } from "@/lib/website-live";
import { hasPermission, type SessionUser } from "@/lib/permissions";
import { cn, formatDate, formatMoney } from "@/lib/utils";

type RecordValue = Record<string, any> & { id: string };
type Related = Record<string, { id: string; name: string }[]>;
const permissionFor: Record<string, string> = { clients: "clients", projects: "projects", tasks: "tasks", websites: "websites", services: "services", invoices: "finance", subscriptions: "finance", expenses: "finance", incidents: "operations" };

function emptyForm(fields: FieldConfig[]) {
  return Object.fromEntries(fields.map((field) => {
    if (field.type === "checkbox") return [field.key, true];
    if (["money", "number"].includes(field.type || "")) return [field.key, "0"];
    if (field.type === "select" && !field.source) return [field.key, field.key === "currency" ? "PHP" : field.options?.[0] || ""];
    if (field.type === "date" && ["issueDate", "dueDate", "incurredAt"].includes(field.key)) return [field.key, new Date().toISOString().slice(0, 10)];
    if (field.type === "links" || field.type === "list") return [field.key, ""];
    return [field.key, ""];
  }));
}

function statsFor(resource: string, records: RecordValue[]) {
  const sum = (key: string, filter: (record: RecordValue) => boolean = () => true) => records.filter(filter).reduce((total, record) => total + Number(record[key] || 0), 0);
  const today = new Date().toISOString().slice(0, 10);
  if (resource === "clients") return [{ label: "Active accounts", value: records.filter((r) => r.status === "active").length, detail: `${records.length} total relationships` }, { label: "Healthy", value: records.filter((r) => r.health === "good").length, detail: "Recorded relationship health" }, { label: "Needs attention", value: records.filter((r) => ["watch", "risk"].includes(r.health)).length, detail: "Watch or risk state" }, { label: "Qualified leads", value: records.filter((r) => r.status === "lead").length, detail: "Not yet active clients" }];
  if (resource === "projects") return [{ label: "Active delivery", value: records.filter((r) => ["active", "review"].includes(r.status)).length, detail: `${records.length} total projects` }, { label: "Average progress", value: `${records.length ? Math.round(records.reduce((s, r) => s + Number(r.progress || 0), 0) / records.length) : 0}%`, detail: "Across all project records" }, { label: "Urgent", value: records.filter((r) => r.priority === "urgent" && r.status !== "complete").length, detail: "Highest delivery priority" }, { label: "Due in 14 days", value: records.filter((r) => r.dueDate >= today && r.dueDate <= new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)).length, detail: "Upcoming milestones" }];
  if (resource === "tasks") return [{ label: "Open tasks", value: records.filter((r) => r.status !== "done").length, detail: `${records.length} total assignments` }, { label: "Due today", value: records.filter((r) => r.status !== "done" && r.dueDate === today).length, detail: "Asia/Manila work queue" }, { label: "In review", value: records.filter((r) => r.status === "review").length, detail: "Awaiting review or approval" }, { label: "Open estimate", value: `${records.filter((r) => r.status !== "done").reduce((s, r) => s + Number(r.estimateHours || 0), 0).toFixed(1)}h`, detail: "Estimated remaining effort" }];
  if (resource === "websites") return [{ label: "Total properties", value: records.length, detail: "Centralized website inventory" }, { label: "Operational", value: records.filter((r) => r.status === "operational").length, detail: "Last recorded state" }, { label: "Needs verification", value: records.filter((r) => ["unknown", "degraded", "offline"].includes(r.status)).length, detail: "Run a real availability check" }, { label: "SSL review window", value: records.filter((r) => r.sslExpiry && r.sslExpiry <= new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)).length, detail: "Recorded dates inside 30 days" }];
  if (resource === "services") return [{ label: "Active services", value: records.filter((r) => r.active).length, detail: `${records.length} catalog entries` }, { label: "Recurring catalog value", value: formatMoney(sum("recurringFeeMinor", (r) => r.active), "PHP", true), detail: "Sum of monthly list prices" }, { label: "Setup fees", value: formatMoney(sum("setupFeeMinor", (r) => r.active), "PHP", true), detail: "Across active offers" }, { label: "Third-party costs", value: formatMoney(sum("thirdPartyCostMinor", (r) => r.active), "PHP", true), detail: "Estimated, separately identified" }];
  if (resource === "invoices") { const valid = (r: RecordValue) => !["draft", "cancelled"].includes(r.status); return [{ label: "Invoiced revenue", value: formatMoney(sum("totalMinor", valid), "PHP", true), detail: "Excludes drafts and cancellations" }, { label: "Cash received", value: formatMoney(sum("amountPaidMinor", valid), "PHP", true), detail: "Actual recorded payments" }, { label: "Outstanding", value: formatMoney(records.filter(valid).reduce((s, r) => s + Math.max(0, Number(r.totalMinor) - Number(r.amountPaidMinor)), 0), "PHP", true), detail: "Open invoice balance" }, { label: "Overdue invoices", value: records.filter((r) => valid(r) && r.dueDate < today && Number(r.amountPaidMinor) < Number(r.totalMinor)).length, detail: "Requires collection review" }]; }
  if (resource === "subscriptions") return [{ label: "Active subscriptions", value: records.filter((r) => r.status === "active").length, detail: `${records.length} total recurring records` }, { label: "Monthly recurring revenue", value: formatMoney(records.filter((r) => r.status === "active").reduce((s, r) => s + (r.billingCycle === "yearly" ? Number(r.amountMinor) / 12 : Number(r.amountMinor)), 0), "PHP", true), detail: "Normalized monthly value" }, { label: "Next 30 days", value: records.filter((r) => r.renewalDate >= today && r.renewalDate <= new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)).length, detail: "Upcoming renewals" }, { label: "Paused / pending", value: records.filter((r) => ["paused", "pending"].includes(r.status)).length, detail: "Not included in active MRR" }];
  if (resource === "expenses") { const monthly = records.filter((r) => r.status !== "refunded").reduce((s, r) => s + (r.billingCycle === "monthly" ? Number(r.amountMinor) : r.billingCycle === "yearly" ? Number(r.amountMinor) / 12 : 0), 0); const topCategory = Object.entries(records.reduce<Record<string, number>>((acc, r) => { acc[r.category] = (acc[r.category] || 0) + Number(r.amountMinor); return acc; }, {})).sort((a, b) => b[1] - a[1])[0]; return [{ label: "Recorded expenses", value: formatMoney(sum("amountMinor", (r) => r.status !== "refunded"), "PHP", true), detail: `${records.length} cost records` }, { label: "Current month", value: formatMoney(sum("amountMinor", (r) => r.status !== "refunded" && String(r.incurredAt).slice(0, 7) === today.slice(0, 7)), "PHP", true), detail: "By incurred date" }, { label: "Recurring run-rate", value: formatMoney(monthly, "PHP", true), detail: "Monthly + yearly÷12 subscriptions" }, { label: "Largest category", value: topCategory ? formatMoney(topCategory[1], "PHP", true) : "—", detail: topCategory?.[0] || "No records" }]; }
  return [{ label: "Open incidents", value: records.filter((r) => r.status !== "resolved").length, detail: `${records.length} operational records` }, { label: "High / critical", value: records.filter((r) => ["high", "critical"].includes(r.severity) && r.status !== "resolved").length, detail: "Prioritized response" }, { label: "Investigating", value: records.filter((r) => r.status === "investigating").length, detail: "Active diagnosis" }, { label: "Resolved", value: records.filter((r) => r.status === "resolved").length, detail: "Resolution evidence retained" }];
}

export function ResourceModule({ resource, user, embedded = false }: { resource: string; user: SessionUser; embedded?: boolean }) {
  const config = MODULES[resource];
  const router = useRouter();
  const detailHref = resource === "projects" ? (record: RecordValue) => `/projects/${record.id}` : resource === "clients" ? (record: RecordValue) => `/clients/${record.id}` : null;
  const permission = permissionFor[resource];
  const canManage = hasPermission(user, `${permission}.manage`);
  const [records, setRecords] = useState<RecordValue[]>([]);
  const [related, setRelated] = useState<Related>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [editing, setEditing] = useState<RecordValue | "new" | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState("");
  const [live, setLive] = useState<WebsiteLiveResponse | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const response = await fetch(`/api/records/${resource}`); const body = await response.json(); if (!response.ok) throw new Error(body.error || "Could not load records."); setRecords(body.records); } catch (reason) { setError(reason instanceof Error ? reason.message : "Load failed."); } finally { setLoading(false); }
  }, [resource]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (resource !== "websites") return;
    let active = true;
    fetch("/api/websites/live").then((response) => response.ok ? response.json() : null).then((body) => { if (active && body) setLive(body); }).catch(() => { /* Live status is additive; the module stays usable without it. */ });
    return () => { active = false; };
  }, [resource]);
  useEffect(() => {
    const sources = [...new Set(config.fields.map((field) => field.source).filter(Boolean))] as string[];
    sources.forEach(async (source) => {
      const url = source === "users" ? "/api/directory" : `/api/records/${source}`;
      try { const response = await fetch(url); if (!response.ok) return; const body = await response.json(); const values = source === "users" ? body.users : body.records; setRelated((current) => ({ ...current, [source]: values.map((item: RecordValue) => ({ id: item.id, name: item.name || item.title })) })); } catch { /* Optional form options do not block record access. */ }
    });
  }, [config.fields]);
  const filtered = useMemo(() => records.filter((record) => (status === "all" || record.status === status) && config.searchKeys.some((key) => String(record[key] || "").toLowerCase().includes(query.toLowerCase()))), [records, status, query, config.searchKeys]);
  const statuses = useMemo(() => [...new Set(records.map((record) => record.status).filter(Boolean))], [records]);
  const summary = statsFor(resource, records);
  const openForm = (record: RecordValue | "new") => {
    setEditing(record); setError("");
    if (record === "new") setForm(emptyForm(config.fields));
    else setForm(Object.fromEntries(config.fields.map((field) => {
      const value = record[field.key];
      if (field.type === "money") return [field.key, String(Number(value || 0) / 100)];
      if (field.type === "links") return [field.key, Array.isArray(value) ? value.map((link: any) => `${link.label} | ${link.url}`).join("\n") : ""];
      if (field.type === "list") return [field.key, Array.isArray(value) ? value.join("\n") : ""];
      if (field.type === "datetime" && value) return [field.key, new Date(value).toISOString().slice(0, 16)];
      return [field.key, value ?? (field.type === "checkbox" ? false : "")];
    })));
  };
  async function save() {
    setSaving(true); setError("");
    const nullable = new Set(["clientId", "projectId", "ownerId", "leadId", "assigneeId", "serviceId", "websiteId", "startDate", "dueDate", "renewalDate", "sslExpiry", "paidAt", "resolvedAt", "previewUrl", "repositoryUrl", "externalRef"]);
    const data = Object.fromEntries(config.fields.map((field) => {
      let value = form[field.key];
      if (field.type === "money") value = Math.round(Number(value || 0) * 100);
      else if (field.type === "number" && field.key !== "estimateHours") value = Number(value || 0);
      else if (field.type === "links") value = String(value || "").split("\n").map((line) => { const [label, url] = line.split("|").map((part) => part?.trim()); return { label, url }; }).filter((link) => link.label && link.url);
      else if (field.type === "list") value = String(value || "").split("\n").map((line) => line.trim()).filter(Boolean);
      else if (field.type === "datetime" && value) value = new Date(value).toISOString();
      else if (nullable.has(field.key) && value === "") value = null;
      return [field.key, value];
    }));
    try {
      const isNew = editing === "new";
      const response = await fetch(`/api/records/${resource}`, { method: isNew ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(isNew ? data : { id: (editing as RecordValue).id, data }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Validation failed.");
      setEditing(null); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Save failed."); } finally { setSaving(false); }
  }
  async function remove(record: RecordValue) {
    const name = record.name || record.title || record.invoiceNumber || record.description || record.id;
    if (!window.confirm(`Permanently delete “${name}”? Related records may prevent this action. This cannot be undone.`)) return;
    const response = await fetch(`/api/records/${resource}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: record.id, confirm: true }) });
    const body = await response.json();
    if (!response.ok) { setError(body.error || "Delete failed."); return; }
    await load();
  }
  async function checkWebsite(record: RecordValue) {
    setChecking(record.id); setError("");
    try { const response = await fetch("/api/websites/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: record.id }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "Check failed."); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Check failed."); } finally { setChecking(""); }
  }
  const value = (record: RecordValue, key: string, type?: string) => {
    const current = record[key];
    if (type === "money") return formatMoney(Number(current || 0), record.currency || "PHP");
    if (type === "date") return current ? formatDate(current) : "Not set";
    if (type === "progress") return <div style={{ display: "flex", alignItems: "center", gap: 7 }}><div className="progress-track" style={{ width: 55 }}><span style={{ width: `${current}%` }} /></div><span>{current}%</span></div>;
    if (type === "status") return <span className={`badge badge-${String(current).toLowerCase()}`}>{typeof current === "boolean" ? current ? "active" : "inactive" : String(current || "unknown").replaceAll("_", " ")}</span>;
    if (type === "link") return current ? <a href={current} target="_blank" rel="noreferrer" className="button button-sm button-ghost">Open <ExternalLink size={11} /></a> : "Not set";
    return String(current || "—");
  };
  return <>
    {!embedded && <div className="page-heading"><div className="page-heading-copy"><div className="eyebrow">{config.eyebrow}</div><h1>{config.title}</h1><p className="page-description">{config.description}</p></div><div className="heading-actions"><button className="button" onClick={load}><RefreshCw size={13} />Refresh</button>{canManage && <button className="button button-primary" onClick={() => openForm("new")}><Plus size={14} />New {config.singular}</button>}</div></div>}
    <div className="stats-grid">{summary.map((stat) => <div className="card stat-card" key={stat.label}><div className="label">{stat.label}</div><div className="value">{stat.value}</div><div className="detail">{stat.detail}</div></div>)}</div>
    <div className="toolbar"><div style={{ position: "relative" }}><Search size={13} style={{ position: "absolute", left: 11, top: 11, color: "var(--muted)" }} /><input className="input" style={{ paddingLeft: 32 }} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${config.title.toLowerCase()}…`} /></div>{statuses.length > 0 && <select className="input" style={{ width: 170 }} value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option>{statuses.map((item) => <option key={item} value={item}>{String(item).replaceAll("_", " ")}</option>)}</select>}<div className="toolbar-spacer" /><span style={{ color: "var(--muted)", fontSize: 10 }}>{filtered.length} of {records.length} records</span>{embedded && canManage && <button className="button button-primary" onClick={() => openForm("new")}><Plus size={13} />New {config.singular}</button>}</div>
    {error && !editing && <div className="form-error" style={{ marginBottom: 14 }}>{error}</div>}
    {resource === "websites" && live && <div className="toolbar" style={{ flexWrap: "wrap", gap: 6 }}>{live.sources.map((source) => <span key={source.key} className={`badge badge-${source.state === "verified" ? "active" : "unknown"}`} title={source.detail}>{source.label}: {source.state.replaceAll("_", " ")}</span>)}<span style={{ color: "var(--muted)", fontSize: 10 }}>Matched by repository URL and domain against synchronized integration data. Unconnected sources are stated, never assumed.</span></div>}
    <section className="card module-table-wrap">{loading ? <div className="card-body"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div> : filtered.length ? <table className="module-table"><thead><tr>{config.columns.map((column) => <th key={column.key}>{column.label}</th>)}{resource === "websites" && <th key="__live">Live status</th>}{canManage && <th style={{ textAlign: "right" }}>Actions</th>}</tr></thead><tbody>{filtered.map((record) => <tr key={record.id} className={detailHref ? "row-clickable" : undefined} tabIndex={detailHref ? 0 : undefined} onClick={detailHref ? () => router.push(detailHref(record)) : undefined} onKeyDown={detailHref ? (event) => { if (event.key === "Enter") router.push(detailHref(record)); } : undefined}>{config.columns.map((column) => <td key={column.key}>{resource === "clients" && column.key === "name" ? <Link href={`/clients/${record.id}`} className="cell-title" style={{ color: "var(--accent)", textDecoration: "none" }} onClick={(event) => event.stopPropagation()}>{value(record, column.key, column.type)}</Link> : column.subkey ? <><span className="cell-title">{value(record, column.key, column.type)}</span><span className="cell-sub">{String(record[column.subkey] || "").slice(0, 90)}</span></> : value(record, column.key, column.type)}</td>)}{resource === "websites" && <td key="__live">{(() => { const entry = live?.byWebsite?.[record.id]; const repo = entry?.repository; const deploy = entry?.deployment; return <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>{repo ? <span className="cell-title" title={repo.meta || ""}>{repo.title}{repo.status ? ` · ${repo.status}` : ""}</span> : <span className="cell-sub">Repository: no live match</span>}{deploy ? <span className="cell-sub" title={deploy.meta || ""}>{deploy.label} · {deploy.status || "state not reported"} · {deploy.title}</span> : <span className="cell-sub">Deployment: no live match</span>}</div>; })()}</td>}{canManage && <td onClick={(event) => event.stopPropagation()}><div className="row-actions">{resource === "websites" && <button className="button button-sm button-ghost" onClick={() => checkWebsite(record)} disabled={checking === record.id} title="Perform a real HTTP availability check">{checking === record.id ? <LoaderCircle size={12} className="animate-spin" /> : <Activity size={12} />}Check</button>}<button className="icon-button" onClick={() => openForm(record)} title="Edit"><Edit3 size={13} /></button><button className="icon-button" onClick={() => remove(record)} title="Delete"><Trash2 size={13} /></button></div></td>}</tr>)}</tbody></table> : <div className="empty-state" style={{ minHeight: 240 }}><Search size={25} /><strong>{records.length ? "No records match these filters" : `No ${config.title.toLowerCase()} yet`}</strong><p>{records.length ? "Clear search or select another status." : canManage ? `Create the first ${config.singular} to begin building this operating record.` : "Records will appear here when an authorized manager creates them."}</p>{!records.length && canManage && <button className="button button-primary" style={{ marginTop: 14 }} onClick={() => openForm("new")}><Plus size={14} />New {config.singular}</button>}</div>}</section>
    {editing && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}><section className="modal modal-lg" role="dialog" aria-modal="true"><div className="modal-header"><div><h2>{editing === "new" ? `New ${config.singular}` : `Edit ${config.singular}`}</h2><p>Changes are validated and persisted in the workspace database.</p></div><button className="icon-button" onClick={() => setEditing(null)}><X size={16} /></button></div><div className="modal-body"><div className="form-grid">{config.fields.map((field) => <div className={cn("field", field.full && "field-full")} key={field.key}>{field.type === "checkbox" ? <label className="checkbox"><input type="checkbox" checked={Boolean(form[field.key])} onChange={(event) => setForm((current: Record<string, any>) => ({ ...current, [field.key]: event.target.checked }))} />{field.label}</label> : <><label>{field.label}{field.required ? " *" : ""}</label>{field.type === "textarea" || field.type === "links" || field.type === "list" ? <textarea value={form[field.key] || ""} onChange={(event) => setForm((current: Record<string, any>) => ({ ...current, [field.key]: event.target.value }))} placeholder={field.help} /> : field.type === "select" ? <select value={form[field.key] ?? ""} onChange={(event) => setForm((current: Record<string, any>) => ({ ...current, [field.key]: event.target.value }))}><option value="">Not assigned</option>{field.source ? related[field.source]?.map((option) => <option value={option.id} key={option.id}>{option.name}</option>) : field.options?.map((option) => <option key={option}>{option.replaceAll("_", " ")}</option>)}</select> : <input type={field.type === "money" || field.type === "number" ? "number" : field.type === "datetime" ? "datetime-local" : field.type || "text"} step={field.type === "money" || field.key === "estimateHours" ? "0.01" : undefined} min={["money", "number"].includes(field.type || "") ? 0 : undefined} value={form[field.key] ?? ""} required={field.required} onChange={(event) => setForm((current: Record<string, any>) => ({ ...current, [field.key]: event.target.value }))} />}{field.help && field.type !== "links" && field.type !== "list" && <small>{field.help}</small>}</>}</div>)}</div>{error && <div className="form-error">{error}</div>}</div><div className="modal-footer"><button className="button" onClick={() => setEditing(null)}>Cancel</button><button className="button button-primary" onClick={save} disabled={saving}>{saving ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}Save {config.singular}</button></div></section></div>}
  </>;
}
