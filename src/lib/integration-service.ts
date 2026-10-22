import { eq } from "drizzle-orm";
import { db } from "@/db";
import { integrationCache, integrations, syncRuns, type IntegrationRecord } from "@/db/schema";
import { decryptSecret } from "@/lib/security";
import type { WidgetItem } from "@/components/widget-types";

type JsonObject = Record<string, unknown>;
const obj = (value: unknown): JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
const arr = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const str = (value: unknown, fallback = "") => typeof value === "string" ? value : value === null || value === undefined ? fallback : String(value);
const num = (value: unknown) => typeof value === "number" ? value : Number(value) || 0;

function endpoint(base: string, path: string) {
  const url = new URL(path.replace(/^\//, ""), base.endsWith("/") ? base : `${base}/`);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Integration URL must be HTTP(S) and cannot contain credentials.");
  return url;
}

async function request(url: URL, headers: Record<string, string>) {
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "MerQato-Command-Center/1.0", ...headers }, signal: AbortSignal.timeout(15_000), cache: "no-store", redirect: "error" });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") throw new Error("Provider request timed out after 15 seconds. Check network access and endpoint availability.");
    throw new Error("Provider could not be reached. Verify the URL, DNS, firewall and server network route.");
  }
  if (!response.ok) {
    let detail = "";
    try {
      const body = obj(await response.json());
      detail = str(body.message || body.error || obj(body.error).message).slice(0, 300);
    } catch { /* Provider status is sufficient and avoids reflecting sensitive bodies. */ }
    const guidance = response.status === 401 ? " Credentials were rejected; rotate or reconnect the token." : response.status === 403 ? " The credential is valid but lacks a required scope or the resource is forbidden." : response.status === 404 ? " The endpoint was not found; verify the installed version and base URL." : "";
    throw new Error(`Provider returned HTTP ${response.status}.${guidance}${detail ? ` ${detail}` : ""}`);
  }
  const length = Number(response.headers.get("content-length") || 0);
  if (length > 10_000_000) throw new Error("Provider response exceeds the 10 MB synchronization limit.");
  return response.json() as Promise<unknown>;
}

async function cache(integrationId: string, resourceKey: string, items: WidgetItem[], sourceUpdatedAt?: Date) {
  await db.insert(integrationCache).values({ integrationId, resourceKey, payload: { items }, sourceUpdatedAt, fetchedAt: new Date() })
    .onConflictDoUpdate({ target: [integrationCache.integrationId, integrationCache.resourceKey], set: { payload: { items }, sourceUpdatedAt, fetchedAt: new Date() } });
  return items.length;
}

function credential(record: IntegrationRecord) {
  const secret = decryptSecret(record.credentialEncrypted);
  if (!secret) throw new Error("No credential is stored. Reconnect this integration with an appropriately scoped credential.");
  return secret;
}

function customBase(record: IntegrationRecord, fallback?: string) {
  const base = record.baseUrl || fallback;
  if (!base) throw new Error(`${record.name} requires an instance URL before connecting.`);
  return base;
}

function linkItem(id: unknown, title: unknown, subtitle: unknown, url: unknown, status?: unknown, meta?: unknown): WidgetItem {
  const href = str(url);
  return { id: str(id), title: str(title, "Untitled"), subtitle: str(subtitle), status: status === undefined ? undefined : str(status), meta: meta === undefined ? undefined : str(meta), ...(href.startsWith("https://") || href.startsWith("http://") ? { url: href } : {}) };
}

async function github(record: IntegrationRecord, mode: "test" | "sync") {
  const token = credential(record);
  const headers = { Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" };
  const base = "https://api.github.com/";
  if (mode === "test") {
    const user = obj(await request(endpoint(base, "user"), headers));
    return { count: 1, detail: `Authenticated as ${str(user.login, "the authorized GitHub identity")}.` };
  }
  const owner = str(record.config.owner);
  const path = owner ? `orgs/${encodeURIComponent(owner)}/repos?per_page=50&sort=updated` : "user/repos?per_page=50&sort=updated&affiliation=owner,collaborator,organization_member";
  const payload = await request(endpoint(base, path), headers);
  const repositories = arr(obj(payload).repositories).length ? arr(obj(payload).repositories) : arr(payload);
  const repoItems = repositories.map((value) => { const repo = obj(value); return linkItem(repo.id, repo.full_name || repo.name, `${str(repo.language, "No language")} · ${str(repo.visibility, repo.private ? "private" : "public")} · ${str(repo.default_branch)}`, repo.html_url, repo.archived ? "archived" : "active", repo.updated_at ? `Updated ${str(repo.updated_at).slice(0, 10)}` : undefined); });
  let count = await cache(record.id, "repos", repoItems);
  const selected = repositories.slice(0, Math.min(10, Math.max(1, num(record.config.maxRepositories) || 5)));
  const resources: Record<string, WidgetItem[]> = { commits: [], issues: [], pulls: [], branches: [], workflows: [], releases: [] };
  const failures: string[] = [];
  for (const value of selected) {
    const repo = obj(value);
    const fullName = str(repo.full_name);
    if (!fullName) continue;
    const calls = [
      { key: "commits", path: `repos/${fullName}/commits?per_page=5` },
      { key: "issues", path: `repos/${fullName}/issues?state=open&per_page=10` },
      { key: "pulls", path: `repos/${fullName}/pulls?state=open&per_page=10` },
      { key: "branches", path: `repos/${fullName}/branches?per_page=10` },
      { key: "workflows", path: `repos/${fullName}/actions/runs?per_page=5` },
      { key: "releases", path: `repos/${fullName}/releases?per_page=5` },
    ];
    const results = await Promise.allSettled(calls.map((call) => request(endpoint(base, call.path), headers)));
    results.forEach((result, index) => {
      const call = calls[index];
      if (result.status === "rejected") { failures.push(`${fullName} ${call.key}: ${result.reason instanceof Error ? result.reason.message : "request failed"}`); return; }
      const data = result.value;
      if (call.key === "commits") resources.commits.push(...arr(data).map((entry) => { const item = obj(entry); const commit = obj(item.commit); const author = obj(commit.author); return linkItem(item.sha, obj(commit).message ? str(obj(commit).message).split("\n")[0] : "Commit", `${fullName} · ${str(author.name, "Unknown author")}`, item.html_url, str(item.sha).slice(0, 7), author.date); }));
      if (call.key === "issues") resources.issues.push(...arr(data).filter((entry) => !obj(entry).pull_request).map((entry) => { const item = obj(entry); return linkItem(item.id, item.title, `${fullName} · #${str(item.number)} · ${str(obj(item.user).login)}`, item.html_url, item.state, arr(item.labels).map((label) => str(obj(label).name)).filter(Boolean).join(", ")); }));
      if (call.key === "pulls") resources.pulls.push(...arr(data).map((entry) => { const item = obj(entry); return linkItem(item.id, item.title, `${fullName} · #${str(item.number)} · ${str(obj(item.user).login)}`, item.html_url, "awaiting review", `${str(obj(item.head).ref)} → ${str(obj(item.base).ref)}`); }));
      if (call.key === "branches") resources.branches.push(...arr(data).map((entry) => { const item = obj(entry); return linkItem(`${fullName}-${str(item.name)}`, item.name, fullName, `${str(repo.html_url)}/tree/${encodeURIComponent(str(item.name))}`, item.protected ? "protected" : "unprotected"); }));
      if (call.key === "workflows") resources.workflows.push(...arr(obj(data).workflow_runs).map((entry) => { const item = obj(entry); return linkItem(item.id, item.name || item.display_title, `${fullName} · ${str(item.event)} · #${str(item.run_number)}`, item.html_url, item.conclusion || item.status, item.updated_at); }));
      if (call.key === "releases") resources.releases.push(...arr(data).map((entry) => { const item = obj(entry); return linkItem(item.id, item.name || item.tag_name, `${fullName} · ${str(obj(item.author).login)}`, item.html_url, item.draft ? "draft" : item.prerelease ? "prerelease" : "published", item.published_at); }));
    });
  }
  for (const [key, items] of Object.entries(resources)) { await cache(record.id, key, items.slice(0, 100)); count += items.length; }
  if (failures.length) throw new Error(`Repository inventory synced, but ${failures.length} resource requests failed. ${failures[0]}`);
  return { count, detail: `Synchronized ${repoItems.length} repositories and supported resources for ${selected.length} repositories.` };
}

async function vercel(record: IntegrationRecord, mode: "test" | "sync") {
  const headers = { Authorization: `Bearer ${credential(record)}` };
  const teamId = str(record.config.teamId);
  const team = teamId ? `${teamId.startsWith("team_") ? "teamId" : "slug"}=${encodeURIComponent(teamId)}&` : "";
  if (mode === "test") { const payload = obj(await request(endpoint("https://api.vercel.com/", "v2/user"), headers)); return { count: 1, detail: `Authenticated Vercel user ${str(obj(payload.user).username, "verified")}.` }; }
  const [projectPayload, deploymentPayload] = await Promise.all([
    request(endpoint("https://api.vercel.com/", `v9/projects?${team}limit=50`), headers),
    request(endpoint("https://api.vercel.com/", `v6/deployments?${team}limit=20`), headers),
  ]);
  const projectItems = arr(obj(projectPayload).projects).map((value) => { const item = obj(value); return linkItem(item.id, item.name, `${str(item.framework, "Framework not reported")} · ${str(obj(item.link).type, "No Git link")}`, `https://vercel.com/${str(item.accountId)}/${str(item.name)}`, "project", item.updatedAt ? new Date(num(item.updatedAt)).toISOString() : undefined); });
  const deploymentItems = arr(obj(deploymentPayload).deployments).map((value) => { const item = obj(value); const meta = obj(item.meta); return linkItem(item.uid || item.id, item.name, `${str(meta.githubCommitRef, str(item.target, "deployment"))} · ${str(meta.githubCommitMessage).slice(0, 100)}`, item.url ? `https://${str(item.url)}` : undefined, item.state || item.readyState, item.created ? new Date(num(item.created)).toISOString() : undefined); });
  const count = await cache(record.id, "projects", projectItems) + await cache(record.id, "deployments", deploymentItems);
  return { count, detail: `Synchronized ${projectItems.length} projects and ${deploymentItems.length} deployments.` };
}

async function coolify(record: IntegrationRecord, mode: "test" | "sync") {
  const base = customBase(record);
  const headers = { Authorization: `Bearer ${credential(record)}` };
  if (mode === "test") { const team = obj(await request(endpoint(base, "api/v1/teams/current"), headers)); return { count: 1, detail: `Connected to Coolify team ${str(team.name, team.id ? String(team.id) : "verified")}.` }; }
  const payload = await request(endpoint(base, "api/v1/applications"), headers);
  const items = arr(payload).map((value) => { const item = obj(value); return linkItem(item.uuid || item.id, item.name, `${str(item.git_repository, "Application")} · ${str(item.git_branch)}`, item.fqdn ? str(item.fqdn).split(",")[0] : undefined, item.status, item.updated_at); });
  const count = await cache(record.id, "applications", items);
  return { count, detail: `Synchronized ${items.length} Coolify applications visible to this team token.` };
}

async function cloudflare(record: IntegrationRecord, mode: "test" | "sync") {
  const headers = { Authorization: `Bearer ${credential(record)}` };
  const payload = obj(await request(endpoint("https://api.cloudflare.com/", "client/v4/zones?per_page=50"), headers));
  const zones = arr(payload.result);
  if (mode === "test") return { count: zones.length, detail: `Token verified with access to ${zones.length} zones.` };
  const zoneItems = zones.map((value) => { const item = obj(value); return linkItem(item.id, item.name, `${str(item.plan && obj(item.plan).name, "Plan unavailable")} · ${str(item.type)}`, `https://dash.cloudflare.com/${str(item.account && obj(item.account).id)}/${str(item.name)}`, item.status, item.created_on); });
  let count = await cache(record.id, "zones", zoneItems);
  const records: WidgetItem[] = [];
  for (const zone of zones.slice(0, 5)) {
    const id = str(obj(zone).id);
    const dns = obj(await request(endpoint("https://api.cloudflare.com/", `client/v4/zones/${encodeURIComponent(id)}/dns_records?per_page=100`), headers));
    records.push(...arr(dns.result).map((value) => { const item = obj(value); return linkItem(item.id, item.name, `${str(item.type)} → ${str(item.content).slice(0, 100)}`, undefined, item.proxied ? "proxied" : "DNS only", `TTL ${str(item.ttl)}`); }));
  }
  count += await cache(record.id, "dns", records);
  return { count, detail: `Synchronized ${zoneItems.length} zones and ${records.length} DNS records.` };
}

async function invoiceShelf(record: IntegrationRecord, mode: "test" | "sync") {
  const base = customBase(record);
  const headers = { Authorization: `Bearer ${credential(record)}` };
  const probe = await request(endpoint(base, `api/v1/invoices?limit=${mode === "test" ? 1 : 100}`), headers);
  if (mode === "test") return { count: 1, detail: "InvoiceShelf invoices endpoint responded. Review synchronized fields before relying on version-specific mappings." };
  const [customersPayload, paymentsPayload] = await Promise.all([
    request(endpoint(base, "api/v1/customers?limit=100"), headers),
    request(endpoint(base, "api/v1/payments?limit=100"), headers),
  ]);
  const invoiceItems = arr(obj(probe).data || probe).map((value) => { const item = obj(value); return linkItem(item.id, item.invoice_number || item.number, `${str(obj(item.customer).name, "Customer unavailable")} · ${str(item.total)}`, undefined, item.status, item.due_date || item.invoice_date); });
  const customerItems = arr(obj(customersPayload).data || customersPayload).map((value) => { const item = obj(value); return linkItem(item.id, item.name, item.email, undefined, "customer"); });
  const paymentItems = arr(obj(paymentsPayload).data || paymentsPayload).map((value) => { const item = obj(value); return linkItem(item.id, item.payment_number || item.id, `${str(item.amount)} · ${str(obj(item.customer).name)}`, undefined, "payment", item.payment_date); });
  const count = await cache(record.id, "invoices", invoiceItems) + await cache(record.id, "customers", customerItems) + await cache(record.id, "payments", paymentItems);
  return { count, detail: `InvoiceShelf adapter received ${invoiceItems.length} invoices, ${customerItems.length} customers and ${paymentItems.length} payments.` };
}

async function openCode(record: IntegrationRecord, mode: "test" | "sync") {
  const base = customBase(record);
  const password = credential(record);
  const username = str(record.config.username, "opencode");
  const headers = { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` };
  const health = obj(await request(endpoint(base, "global/health"), headers));
  if (mode === "test") return { count: 1, detail: `OpenCode server ${str(health.version, "reported healthy")} responded.` };
  const sessionPayload = await request(endpoint(base, "session/status"), headers);
  const healthItem = linkItem("health", `OpenCode ${str(health.version, "server")}`, "Verified /global/health response", record.baseUrl, health.healthy ? "healthy" : "degraded", new Date().toISOString());
  const sessionItems = Object.entries(obj(sessionPayload)).map(([id, value]) => { const item = obj(value); return linkItem(id, item.title || `Session ${id.slice(0, 8)}`, item.type || "Session status", undefined, item.type || item.status, item.time && str(obj(item.time).updated)); });
  const count = await cache(record.id, "health", [healthItem]) + await cache(record.id, "sessions", sessionItems);
  return { count, detail: `OpenCode health verified; ${sessionItems.length} session status records received. No execution action was performed.` };
}

async function openRouter(record: IntegrationRecord, mode: "test" | "sync") {
  const headers = { Authorization: `Bearer ${credential(record)}` };
  const payload = obj(await request(endpoint("https://openrouter.ai/", "api/v1/auth/key"), headers));
  const data = obj(payload.data);
  if (mode === "test") return { count: 1, detail: `OpenRouter key responded${data.label ? ` as ${str(data.label)}` : ""}.` };
  const item = linkItem("account", str(data.label, "OpenRouter account key"), `Usage: ${data.usage === undefined ? "not exposed" : str(data.usage)} · Limit: ${data.limit === null || data.limit === undefined ? "not set / not exposed" : str(data.limit)}`, "https://openrouter.ai/settings/keys", data.is_free_tier === true ? "free tier" : "account", data.limit_remaining === undefined ? "Remaining credit not exposed" : `Remaining ${str(data.limit_remaining)}`);
  const count = await cache(record.id, "account", [item]);
  return { count, detail: "OpenRouter account response cached. Only provider-returned fields are displayed." };
}

async function ollama(record: IntegrationRecord, mode: "test" | "sync") {
  const base = customBase(record);
  const headers: Record<string, string> = record.credentialEncrypted ? { Authorization: `Bearer ${credential(record)}` } : {};
  const payload = obj(await request(endpoint(base, "api/tags"), headers));
  const models = arr(payload.models);
  if (mode === "test") return { count: models.length, detail: `Ollama responded with ${models.length} available models.` };
  const items = models.map((value) => { const item = obj(value); return linkItem(item.digest || item.name, item.name, `${str(obj(item.details).family, "Model")} · ${str(obj(item.details).parameter_size)}`, undefined, "available", item.size ? `${(num(item.size) / 1e9).toFixed(1)} GB` : undefined); });
  const count = await cache(record.id, "models", items);
  return { count, detail: `Ollama returned ${items.length} models. Availability is based on /api/tags only.` };
}

async function upcloud(record: IntegrationRecord, mode: "test" | "sync") {
  const base = record.baseUrl || "https://api.upcloud.com/1.3/";
  const headers = { Authorization: `Basic ${Buffer.from(credential(record)).toString("base64")}` };
  const payload = obj(await request(endpoint(base, "server"), headers));
  const servers = arr(obj(payload.servers).server);
  if (mode === "test") return { count: servers.length, detail: `UpCloud credentials can read ${servers.length} servers.` };
  const items = servers.map((value) => { const item = obj(value); return linkItem(item.uuid, item.title || item.hostname, `${str(item.plan)} · ${str(item.zone)} · Guest resource metrics not included`, `https://hub.upcloud.com/servers/${str(item.uuid)}`, item.state, item.license ? `License ${str(item.license)}` : undefined); });
  const count = await cache(record.id, "servers", items);
  return { count, detail: `UpCloud returned ${items.length} servers. CPU, RAM, storage and network metrics were not inferred.` };
}

const adapters = { github, vercel, coolify, cloudflare, invoiceshelf: invoiceShelf, opencode: openCode, openrouter: openRouter, ollama, upcloud } as const;

export async function runIntegration(record: IntegrationRecord, mode: "test" | "sync") {
  const adapter = adapters[record.key as keyof typeof adapters];
  if (!adapter) throw new Error("No server adapter is registered for this integration.");
  let runId: string | null = null;
  if (mode === "sync") {
    const [run] = await db.insert(syncRuns).values({ integrationId: record.id, status: "running", triggerType: "manual" }).returning();
    runId = run.id;
  }
  try {
    const result = await adapter(record, mode);
    await db.update(integrations).set({ status: "connected", enabled: true, lastCheckedAt: new Date(), lastSuccessAt: new Date(), lastSyncAt: mode === "sync" ? new Date() : record.lastSyncAt, lastError: null, updatedAt: new Date() }).where(eq(integrations.id, record.id));
    if (runId) await db.update(syncRuns).set({ status: "success", recordsSynced: result.count, finishedAt: new Date() }).where(eq(syncRuns.id, runId));
    return result;
  } catch (error) {
    let message = (error instanceof Error ? error.message : "Integration request failed.").replace(/(token|password|authorization|api[_-]?key)\s*[:=]\s*\S+/gi, "$1=[redacted]").slice(0, 1200);
    try { const stored = decryptSecret(record.credentialEncrypted); if (stored) for (const part of [stored, ...stored.split(":")]) if (part.length >= 4) message = message.replaceAll(part, "[redacted]"); } catch { /* The generic provider error remains available without exposing credential material. */ }
    const cached = await db.select({ id: integrationCache.id }).from(integrationCache).where(eq(integrationCache.integrationId, record.id)).limit(1);
    await db.update(integrations).set({ status: cached.length ? "degraded" : "error", lastCheckedAt: new Date(), lastError: message, updatedAt: new Date() }).where(eq(integrations.id, record.id));
    if (runId) await db.update(syncRuns).set({ status: "failed", error: message, finishedAt: new Date() }).where(eq(syncRuns.id, runId));
    throw new Error(message);
  }
}

export function publicIntegration(record: IntegrationRecord) {
  return {
    id: record.id,
    key: record.key,
    name: record.name,
    category: record.category,
    description: record.description,
    status: record.status,
    enabled: record.enabled,
    authMethod: record.authMethod,
    baseUrl: record.baseUrl,
    docsUrl: record.docsUrl,
    capabilities: record.capabilities,
    scopes: record.scopes,
    config: record.config,
    hasCredential: Boolean(record.credentialEncrypted),
    credentialHint: record.credentialHint,
    allowedRoles: record.allowedRoles,
    lastSyncAt: record.lastSyncAt,
    lastSuccessAt: record.lastSuccessAt,
    lastError: record.lastError,
    lastCheckedAt: record.lastCheckedAt,
  };
}
