import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";

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

function loadEnv() {
  try {
    for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    // No local env file: credentialed tests will be skipped.
  }
}

// Creates a short-lived session row so authenticated checks run without embedding the admin password.
async function sessionFromDatabase(): Promise<string> {
  loadEnv();
  const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!connectionString) return "";
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const [account] = (await client.query(`select id from users where status = 'active' order by created_at limit 1`)).rows;
    if (!account) return "";
    const token = randomBytes(32).toString("base64url");
    await client.query(`insert into sessions (user_id, token_hash, expires_at) values ($1, $2, now() + interval '30 minutes')`, [account.id, createHash("sha256").update(token).digest("hex")]);
    return `merqato_session=${token}`;
  } finally {
    await client.end();
  }
}

before(async () => {
  try {
    const probe = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) });
    reachable = probe.ok || probe.status === 503;
    if (!reachable) return;
    const email = process.env.DASHBOARD_ADMIN_EMAIL;
    const password = process.env.DASHBOARD_ADMIN_PASSWORD;
    if (email && password) {
      const login = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const cookies = typeof login.headers.getSetCookie === "function" ? login.headers.getSetCookie() : [];
      const session = cookies.find((value) => value.startsWith("merqato_session="));
      if (session) cookie = session.split(";")[0];
    }
    if (!cookie) cookie = await sessionFromDatabase();
  } catch {
    reachable = false;
  }
});

test("passwordless demo access is refused in real-use mode", async (t) => {
  if (!reachable) return t.skip("dashboard is not running");
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access: "local-workspace" }),
  });
  assert.equal(response.status, 403, "demo auto sign-in must not be available");
  const body = await response.json();
  assert.match(body.error, /email and password/i);
});

test("sign-in rejects wrong credentials without confirming the account", async (t) => {
  if (!reachable) return t.skip("dashboard is not running");
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "nobody@example.com", password: "definitely-not-the-password" }),
  });
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error, "Email or password is incorrect.");
  assert.equal(response.headers.get("set-cookie"), null, "a failed sign-in must not issue a session");
});

test("sign-in accepts the configured administrator password", async (t) => {
  if (!reachable) return t.skip("dashboard is not running");
  if (!process.env.DASHBOARD_ADMIN_EMAIL || !process.env.DASHBOARD_ADMIN_PASSWORD) return t.skip("DASHBOARD_ADMIN_EMAIL/PASSWORD not set");
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: process.env.DASHBOARD_ADMIN_EMAIL, password: process.env.DASHBOARD_ADMIN_PASSWORD }),
  });
  assert.equal(response.status, 200);
  const cookies = response.headers.getSetCookie?.() ?? [];
  assert.ok(cookies.some((value) => value.startsWith("merqato_session=")), "a successful sign-in must issue a session cookie");
});

test("protected endpoints reject unauthenticated requests", async (t) => {
  if (!reachable) return t.skip("dashboard is not running");
  const saved = cookie;
  cookie = "";
  try {
    for (const path of ["/api/integrations", "/api/websites/live", "/api/records/websites", "/api/widgets/data", "/api/leads"]) {
      const response = await api(path, path === "/api/widgets/data" ? { method: "POST", body: JSON.stringify({ key: "repository-inventory", action: "sync" }) } : {});
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

test("leads carry real prospects with no invented values", async (t) => {
  if (!reachable) return t.skip("dashboard is not running");
  const response = await api("/api/leads");
  assert.equal(response.status, 200);
  const prospects = response.body.prospects ?? [];
  assert.ok(prospects.length >= 85, `expected the imported directory, saw ${prospects.length} prospects`);
  assert.equal(prospects.some((p: any) => String(p.email).endsWith(".example")), false, "fictional seed prospects must be gone");
  for (const prospect of prospects) {
    assert.ok(["unverified", "partial", "verified"].includes(prospect.verification), `unexpected verification ${prospect.verification}`);
    assert.ok(["new", "contacted", "pitched", "negotiating", "won", "declined", "no_response"].includes(prospect.stage));
    assert.equal(Number(prospect.estimatedValueMinor), 0, "imported leads must not carry invented deal values");
    assert.equal(Array.isArray(prospect.pitchedServices) && prospect.pitchedServices.length, 0, "imported leads must not carry invented pitches");
  }
});
