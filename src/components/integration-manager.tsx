"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Blocks, Check, KeyRound, LoaderCircle, Plug, Plus, RefreshCw, Search, Settings2, Trash2, X } from "lucide-react";
import { hasPermission, type SessionUser } from "@/lib/permissions";
import { cn, relativeTime } from "@/lib/utils";
import { AGENT_ACCESS } from "@/lib/agent-access";

type Integration = { id: string; key: string; name: string; category: string; description: string; status: string; enabled: boolean; authMethod: string; baseUrl: string | null; docsUrl: string; capabilities: string[]; scopes: string[]; allowedRoles: string[]; config: Record<string, any>; hasCredential: boolean; credentialHint: string | null; lastSyncAt: string | null; lastSuccessAt: string | null; lastError: string | null; lastCheckedAt: string | null };
type History = { run: { id: string; integrationId: string; status: string; triggerType: string; recordsSynced: number; error: string | null; startedAt: string; finishedAt: string | null }; integrationName: string };

/**
 * Shows whether OpenCode itself can call this provider, separately from whether
 * the dashboard has a stored credential. Green here always means a request
 * actually succeeded, never that a token merely exists.
 */
function AgentAccessLine({ integrationKey }: { integrationKey: string }) {
  const access = AGENT_ACCESS.find((entry) => entry.key === integrationKey);
  if (!access) return <div className="agent-access"><strong>OpenCode: not assessed</strong><small>No verified access entry for this provider yet.</small></div>;
  const headline = access.access === "direct" ? "OpenCode can use it" : access.access === "dashboard" ? "Dashboard only" : "OpenCode blocked";
  return <div className={cn("agent-access", `agent-access-${access.access}`)}>
    <strong>{headline}{access.verified ? <span style={{ fontWeight: 400, color: "var(--muted)" }}> · checked {access.verified}</span> : null}</strong>
    <small>{access.access === "blocked" ? access.note : access.permissions}</small>
  </div>;
}

export function IntegrationManager({ user }: { user: SessionUser }) {
  const [items, setItems] = useState<Integration[]>([]);
  const [history, setHistory] = useState<History[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [selected, setSelected] = useState<Integration | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [accountLabel, setAccountLabel] = useState("");
  const [config, setConfig] = useState<Record<string, any>>({});
  const [rolesText, setRolesText] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const canManage = hasPermission(user, "integrations.manage");
  const canCredentials = hasPermission(user, "credentials.manage");
  const load = useCallback(async () => { setLoading(true); try { const response = await fetch("/api/integrations"); const body = await response.json(); if (response.ok) { setItems(body.integrations); setHistory(body.history); } else setMessage({ text: body.error, error: true }); } finally { setLoading(false); } }, []);
  useEffect(() => { load(); }, [load]);
  const categories = ["All", ...new Set(items.map((item) => item.category))];
  const filtered = useMemo(() => items.filter((item) => (category === "All" || item.category === category) && `${item.name} ${item.description}`.toLowerCase().includes(query.toLowerCase())), [items, category, query]);
  const open = (item: Integration) => { setSelected(item); setBaseUrl(item.baseUrl || ""); setSecret(""); setAccountLabel(""); setRolesText(item.allowedRoles.join(", ")); setConfig({ owner: item.config.owner || "", teamId: item.config.teamId || "", username: item.config.username || "opencode", maxRepositories: item.config.maxRepositories || 12 }); setMessage(null); };
  const replace = (item: Integration | null) => { if (!item) return; setItems((current) => current.map((existing) => existing.id === item.id ? item : existing)); if (selected?.id === item.id) setSelected(item); };
  async function save() {
    if (!selected) return;
    setBusy("save"); setMessage(null);
    try { const response = await fetch(`/api/integrations/${selected.key}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseUrl: selected.config.configurableUrl ? baseUrl || null : undefined, secret: secret || undefined, replace: Boolean(secret), config, allowedRoles: rolesText.split(",").map((role) => role.trim()).filter(Boolean) }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "Configuration failed."); replace(body.integration); setMessage({ text: secret ? "Configuration and encrypted credential saved. Test the connection before relying on it." : "Configuration saved." }); setSecret(""); setSelected(null); } catch (reason) { setMessage({ text: reason instanceof Error ? reason.message : "Configuration failed.", error: true }); } finally { setBusy(""); }
  }
  async function action(item: Integration, name: "test" | "sync" | "disconnect") {
    if (name === "disconnect" && !window.confirm(`Remove the locally encrypted ${item.name} credential and disable this integration? You must also revoke it in the provider console.`)) return;
    setBusy(`${item.key}-${name}`); setMessage(null);
    try { const response = await fetch(`/api/integrations/${item.key}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: name, confirmation: name === "disconnect" ? "DISCONNECT" : undefined }) }); const body = await response.json(); replace(body.integration); if (!response.ok) throw new Error(body.error || "Provider action failed."); setMessage({ text: name === "disconnect" ? body.guidance : name === "test" ? `Connection verified. ${body.result.detail}` : `Synchronization complete. ${body.result.detail}` }); if (name === "sync") load(); } catch (reason) { setMessage({ text: reason instanceof Error ? reason.message : "Provider action failed.", error: true }); } finally { setBusy(""); }
  }
  async function addAccount(item: Integration, label: string, token: string) {
    if (!token.trim()) { setMessage({ text: "Paste the token for the account you want to add.", error: true }); return; }
    setBusy("account"); setMessage(null);
    try {
      const response = await fetch(`/api/integrations/${item.key}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: token.trim(), accountLabel: label.trim() || undefined }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not store the account credential.");
      replace(body.integration); setSecret(""); setAccountLabel("");
      // Verify immediately so the account shows the identity the provider returns.
      const verify = await fetch(`/api/integrations/${item.key}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "test" }) });
      const verified = await verify.json();
      if (verified.integration) replace(verified.integration);
      setMessage(verify.ok ? { text: verified.result.detail } : { text: verified.error || "Account stored, but verification failed.", error: true });
      load();
    } catch (reason) { setMessage({ text: reason instanceof Error ? reason.message : "Could not store the account credential.", error: true }); } finally { setBusy(""); }
  }
  async function removeAccount(item: Integration, accountId: string, label: string) {
    if (!window.confirm(`Remove ${label} from ${item.name}? Revoke the token at the provider to complete revocation.`)) return;
    setBusy(`account-${accountId}`); setMessage(null);
    try {
      const response = await fetch(`/api/integrations/${item.key}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "remove-account", accountId }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not remove the account.");
      replace(body.integration); setMessage({ text: body.guidance }); load();
    } catch (reason) { setMessage({ text: reason instanceof Error ? reason.message : "Could not remove the account.", error: true }); } finally { setBusy(""); }
  }
  async function toggle(item: Integration) {
    setBusy(`${item.key}-toggle`);
    const response = await fetch(`/api/integrations/${item.key}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !item.enabled }) });
    const body = await response.json(); if (response.ok) replace(body.integration); else setMessage({ text: body.error, error: true }); setBusy("");
  }
  const accounts: { id: string; label?: string; login?: string; error?: string; checkedAt?: string }[] = selected && Array.isArray(selected.config.accounts) ? selected.config.accounts : [];
  return <>
    <div className="page-heading"><div className="page-heading-copy"><div className="eyebrow">Official APIs · verified states</div><h1>Integration control</h1><p className="page-description">Connect the systems that run the agency. Disconnected providers never supply demo metrics to live integration widgets.</p></div><div className="heading-actions"><button className="button" onClick={load}><RefreshCw size={13} />Refresh states</button></div></div>
    <div className="notice"><KeyRound size={16} /><div><strong>Server-side credentials.</strong> Secrets are encrypted with AES-256-GCM and excluded from every browser response. Use read-only, narrowly scoped tokens first. Local disconnect does not revoke a provider token.</div></div>
    {message && <div className={message.error ? "form-error" : "form-success"} style={{ marginBottom: 14 }}>{message.text}</div>}
    <div className="toolbar"><div style={{ position: "relative" }}><Search size={13} style={{ position: "absolute", left: 11, top: 11, color: "var(--muted)" }} /><input className="input" style={{ paddingLeft: 32 }} placeholder="Search integrations…" value={query} onChange={(event) => setQuery(event.target.value)} /></div><select className="input" style={{ width: 210 }} value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select><div className="toolbar-spacer" /><span style={{ color: "var(--muted)", fontSize: 10 }}>{items.filter((item) => item.status === "connected").length} connected · {items.filter((item) => item.status === "error" || item.status === "degraded").length} need attention</span></div>
    {loading ? <div className="integration-grid">{[1, 2, 3, 4].map((item) => <div className="card integration-card" key={item}><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>)}</div> : <div className="integration-grid">{filtered.map((item) => <section className="card integration-card" key={item.id}>
      <div className="integration-top"><div className="integration-logo">{item.name.slice(0, 2).toUpperCase()}</div><div className="integration-title"><h3>{item.name}{item.key === "opencode" && <span className="badge" style={{ marginLeft: 7 }}>Primary agent</span>}</h3><p>{item.category} · {item.authMethod}</p></div><span className={`badge badge-${item.status}`}>{item.status}</span></div>
      <p className="integration-description">{item.description}</p><div className="integration-meta">{item.capabilities.slice(0, 3).map((capability) => <span className="badge" key={capability}>{capability}</span>)}</div>
      <div style={{ color: "var(--muted)", fontSize: 9, lineHeight: 1.7 }}>{item.hasCredential ? `Credential ${item.credentialHint || "stored"}` : "No credential stored"} · Last successful test {relativeTime(item.lastSuccessAt)}<br />Last sync {relativeTime(item.lastSyncAt)} · Scopes: {item.scopes.length ? item.scopes.join(", ") : "none recorded"}</div>
      <AgentAccessLine integrationKey={item.key} />
      {item.lastError && <div className="integration-error">{item.lastError}</div>}
      <div className="integration-actions">{canManage && <button className="button button-sm button-primary" onClick={() => open(item)}><Settings2 size={12} />{item.hasCredential || item.baseUrl ? "Configure" : "Connect"}</button>}{canManage && <button className="button button-sm" disabled={Boolean(busy)} onClick={() => action(item, "test")}>{busy === `${item.key}-test` ? <LoaderCircle size={12} className="animate-spin" /> : <Plug size={12} />}Test</button>}{canManage && <button className="button button-sm" disabled={Boolean(busy) || !item.hasCredential && item.key !== "ollama"} onClick={() => action(item, "sync")}>{busy === `${item.key}-sync` ? <LoaderCircle size={12} className="animate-spin" /> : <RefreshCw size={12} />}Sync</button>}<a className="button button-sm button-ghost" href={item.docsUrl} target="_blank" rel="noreferrer" title="Official documentation"><ArrowUpRight size={13} /></a><div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>{canManage && item.hasCredential && <button className="button button-sm button-ghost" onClick={() => toggle(item)}>{item.enabled ? "Disable" : "Enable"}</button>}{canCredentials && item.hasCredential && <button className="icon-button" title="Disconnect and remove local credential" onClick={() => action(item, "disconnect")}><Trash2 size={13} /></button>}</div></div>
    </section>)}</div>}
    <section className="card" style={{ marginTop: 20 }}><div className="card-header"><h2>Synchronization history</h2><span className="badge" style={{ marginLeft: "auto" }}>{history.length} recent runs</span></div>{history.length ? <div className="module-table-wrap"><table className="module-table"><thead><tr><th>Provider</th><th>Status</th><th>Trigger</th><th>Records</th><th>Started</th><th>Detail</th></tr></thead><tbody>{history.map((row) => <tr key={row.run.id}><td>{row.integrationName}</td><td><span className={`badge badge-${row.run.status}`}>{row.run.status}</span></td><td>{row.run.triggerType}</td><td>{row.run.recordsSynced}</td><td>{relativeTime(row.run.startedAt)}</td><td style={{ maxWidth: 330, color: row.run.error ? "var(--danger)" : "var(--muted)" }}>{row.run.error || "Completed without a provider error"}</td></tr>)}</tbody></table></div> : <div className="empty-state"><Blocks size={23} /><strong>No synchronization runs yet</strong><p>Test a connection, then run a manual sync to create a verified history record.</p></div>}</section>
    {selected && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><section className="modal"><div className="modal-header"><div><h2>Configure {selected.name}</h2><p>{selected.authMethod}. Credentials are write-only in this interface.</p></div><button className="icon-button" onClick={() => setSelected(null)}><X size={16} /></button></div><div className="modal-body"><div className="form-grid">
      {selected.config.configurableUrl && <div className="field field-full"><label>Instance URL</label><input type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder={selected.key === "ollama" || selected.key === "opencode" ? "http://private-service:4096" : "https://your-instance.example"} /><small>Use the instance root, not an /api/v1 suffix. Private endpoints require network routing and must not be exposed publicly.</small></div>}
      {accounts.length > 0 ? <div className="field field-full"><label>Connected accounts ({accounts.length})</label>
        <div style={{ display: "grid", gap: 6 }}>
          {accounts.map((account) => <div key={account.id} style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid var(--line)", borderRadius: 8, padding: "7px 9px" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11 }}><strong>{account.login || account.label || account.id}</strong>{account.login && account.label && account.label !== account.login ? <span style={{ color: "var(--muted)" }}> · {account.label}</span> : null}</div>
              {account.error ? <div style={{ color: "var(--danger)", fontSize: 10 }}>{account.error}</div> : <div style={{ color: "var(--muted)", fontSize: 10 }}>{account.checkedAt ? `Verified ${relativeTime(account.checkedAt)}` : "Not verified yet"}</div>}
            </div>
            {canCredentials && <button className="icon-button" title="Remove this account" disabled={Boolean(busy)} onClick={() => removeAccount(selected, account.id, account.login || account.label || account.id)}><Trash2 size={12} /></button>}
          </div>)}
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <input value={accountLabel} onChange={(event) => setAccountLabel(event.target.value)} placeholder="Label (optional)" style={{ flex: "0 0 34%" }} />
          <input type="password" autoComplete="off" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="Token for another account" style={{ flex: 1 }} />
          <button className="button button-sm" disabled={busy === "account" || !secret.trim() || !canCredentials} onClick={() => addAccount(selected, accountLabel, secret)}>{busy === "account" ? <LoaderCircle size={12} className="animate-spin" /> : <Plus size={12} />}Add account</button>
        </div>
        <small>Each account keeps its own encrypted token. The provider identity replaces the label once verified, so accounts stay distinct.</small>
      </div> : <div className="field field-full"><label>{selected.config.secretLabel || "API credential"}{selected.hasCredential ? " (leave blank to retain)" : ""}</label><input type="password" autoComplete="off" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder={selected.hasCredential ? "••••••••••••" : "Paste a narrowly scoped credential"} /><small>Never embedded in URLs, audit metadata, logs or subsequent browser responses.</small></div>}
      {selected.key === "github" && <><div className="field"><label>GitHub organization (optional)</label><input value={config.owner || ""} onChange={(event) => setConfig((current) => ({ ...current, owner: event.target.value }))} placeholder="merqato" /></div><div className="field"><label>Repositories for detailed sync</label><input type="number" min={1} max={100} value={config.maxRepositories || 12} onChange={(event) => setConfig((current) => ({ ...current, maxRepositories: Number(event.target.value) }))} /></div></>}
      {selected.key === "vercel" && <div className="field field-full"><label>Team ID or slug (optional)</label><input value={config.teamId || ""} onChange={(event) => setConfig((current) => ({ ...current, teamId: event.target.value }))} /></div>}
      {selected.key === "opencode" && <div className="field field-full"><label>OpenCode server username</label><input value={config.username || "opencode"} onChange={(event) => setConfig((current) => ({ ...current, username: event.target.value }))} /></div>}
      <div className="field field-full"><label>Allowed role slugs (blank = every role with integrations.view)</label><input value={rolesText} onChange={(event) => setRolesText(event.target.value)} placeholder="administrator, developer, automation-operator" /><small>Examples: administrator, agency-manager, developer, automation-operator, finance-manager.</small></div>
      <div className="field field-full"><label>Permission / scope guidance</label><div className="notice" style={{ margin: 0 }}>{selected.scopes.join(" · ")}</div></div>
      {selected.config.limitation && <div className="field field-full"><div className="notice notice-warning" style={{ margin: 0 }}>{selected.config.limitation}</div></div>}
    </div>{message && <div className={message.error ? "form-error" : "form-success"}>{message.text}</div>}</div><div className="modal-footer"><a className="button" href={selected.docsUrl} target="_blank" rel="noreferrer">Official docs <ArrowUpRight size={12} /></a><button className="button button-primary" onClick={save} disabled={busy === "save" || (!canCredentials && Boolean(secret))}>{busy === "save" ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}Save securely</button></div></section></div>}
  </>;
}
