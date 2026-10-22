import { test, before } from "node:test";
import assert from "node:assert/strict";

// Live checks against a running dashboard. Skipped entirely when the server is not up,
// so `npm test` stays green on a machine with no local instance.
const BASE = process.env.DASHBOARD_URL || "http://localhost:3100";
let cookie = "";
let reachable = false;

async function api(path: string, init: RequestInit = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}), ...(init.headers || {}) },
  });
  const text = await response.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
  return { status: response.status, body, text };
}

before(async () => {
  try {
    const probe = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) });
    reachable = probe.ok || probe.status === 503;
    if (!reachable) return;
    const login = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access: "local-workspace" }),
    });
    if (login.ok) cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  } catch {
    reachable = false;
  }
});

test("protected endpoints reject unauthenticated requests", async (t) => {
  if (!reachable) return t.skip("dashboard is not running");
  // The access-pause cookie forces the anonymous branch even while demo auto-sign-in is active,
  // so this verifies the guard itself rather than the demo convenience path.
  const saved = cookie;
  cookie = "merqato_access_paused=1";
  try {
    for (const path of ["/api/integrations", "/api/websites/live", "/api/records/websites", "/api/widgets/data"]) {
      const response = await api(path, path === "/api/widgets/data" || path === "/api/integrations/github" ? { method: "POST", body: JSON.stringify({ key: "repository-inventory", action: "sync" }) } : {});
      assert.equal(response.status, 401, `${path} must not answer unauthenticated requests`);
    }
    const sync = await api("/api/integrations/github", { method: "POST", body: JSON.stringify({ action: "sync" }) });
    assert.equal(sync.status, 401, "provider synchronization must require a session");
  } finally {
    cookie = saved;
  }
});

test("integration responses never carry stored credentials", async (t) => {
  if (!reachable) return t.skip("dashboard is not running");
  const response = await api("/api/integrations");
  assert.equal(response.status, 200);
  assert.equal(/credentialEncrypted|"secret"|base64url|\bv1\.[A-Za-z0-9_-]{10,}/.test(response.text), false);
});

test("GitHub keeps three independent verified accounts", async (t) => {
  if (!reachable) return t.skip("dashboard is not running");
  const response = await api("/api/integrations");
  assert.equal(response.status, 200);
  const github = response.body.integrations.find((row: any) => row.key === "github");
  assert.ok(github, "github integration must exist");
  assert.equal(github.status, "connected");
  const accounts = github.config?.accounts ?? [];
  assert.ok(accounts.length >= 3, `expected three GitHub accounts, saw ${accounts.length}`);
  assert.equal(new Set(accounts.map((account: any) => account.id)).size, accounts.length, "account ids must be unique");
  assert.ok(accounts.every((account: any) => typeof account.label === "string" && account.label.length > 0), "every account carries a label");
});

test("repeated synchronization stays idempotent", async (t) => {
  if (!reachable) return t.skip("dashboard is not running");
  const syncOnce = async () => {
    const run = await api("/api/integrations/github", { method: "POST", body: JSON.stringify({ action: "sync" }) });
    assert.equal(run.status, 200, JSON.stringify(run.body).slice(0, 200));
    const widget = await api("/api/widgets/data", { method: "POST", body: JSON.stringify({ key: "repository-inventory" }) });
    assert.equal(widget.status, 200);
    return widget.body;
  };
  const first = await syncOnce();
  const second = await syncOnce();
  const ids = (data: any) => (data?.items ?? data?.data?.items ?? []).map((item: any) => item.id);
  const before = ids(first);
  const after = ids(second);
  assert.equal(new Set(after).size, after.length, "cached repositories must not contain duplicate ids");
  assert.equal(after.length, before.length, "a repeated sync must not change the cached record count");
});

test("website live status reports each source honestly", async (t) => {
  if (!reachable) return t.skip("dashboard is not running");
  const response = await api("/api/websites/live");
  assert.equal(response.status, 200);
  const sources = response.body.sources ?? [];
  assert.equal(sources.length, 3);
  for (const source of sources) {
    assert.ok(["verified", "not_connected", "no_sync", "error"].includes(source.state), `unexpected state ${source.state}`);
    if (source.state !== "verified") assert.ok(source.detail.length > 0, "unavailable sources must explain why");
  }
});
