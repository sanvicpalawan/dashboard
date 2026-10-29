#!/usr/bin/env node
/**
 * MerQato health monitor.
 *
 * Every 15 minutes this asks the dashboard two questions — are the integrations
 * still connected, and is the VPS still healthy — and writes a warning to the
 * notifications table when the answer is no. The one-sentence summary is written
 * by the local Ollama model so the check costs nothing and the facts never leave
 * this machine.
 *
 * It talks to the dashboard with the agent bearer token, not a browser session,
 * so it connects through Cloudflare Access the same way any other machine client
 * does: service-token headers plus `Authorization: Bearer $AGENT_API_KEY`.
 *
 * USAGE
 *   node scripts/health-monitor.mjs            # loop, every INTERVAL_MINUTES
 *   node scripts/health-monitor.mjs --once     # single check, for Task Scheduler
 *   node scripts/health-monitor.mjs --dry-run  # single check, never notifies
 *
 * ENVIRONMENT (nothing is hard-coded, nothing is read from a checked-in file)
 *   AGENT_API_KEY              the dashboard agent bearer token
 *   DASHBOARD_URL              default https://command.merqato.digital
 *   CF_ACCESS_CLIENT_ID        required while Cloudflare Access protects the host
 *   CF_ACCESS_CLIENT_SECRET    required while Cloudflare Access protects the host
 *
 *   Each of those three secrets falls back to a file under ~/.secrets when the
 *   environment variable is absent: agent-api-key, cf-access-client-id and
 *   cf-access-client-secret. This matters because PowerShell's `$env:NAME = "…"`
 *   is per process: it disappears with the window that set it, so a scheduled or
 *   freshly opened terminal starts with nothing and every call comes back as a
 *   Cloudflare login page. The file keeps working either way.
 *
 *   OLLAMA_URL                 default http://127.0.0.1:11434
 *   OLLAMA_MODEL               default qwen2.5-coder:3b
 *   INTERVAL_MINUTES           default 15
 *   LOAD_THRESHOLD             default 85 (percent, applied to CPU, memory and disk)
 *   RENOTIFY_HOURS             default 6 (how long an unchanged problem stays quiet)
 *   INTEGRATIONS               default github,cloudflare,coolify
 *   MONITOR_STATE_DIR          default <tmp>/merqato-health-monitor
 *
 * DESIGN NOTES
 *   - A failure to reach the dashboard is itself an alert, not a silent skip.
 *   - An unchanged problem is not re-announced every quarter hour; the fingerprint
 *     of the problem set is remembered, so one broken integration produces one
 *     notification and then quiet until it is fixed or RENOTIFY_HOURS pass.
 *   - If Ollama is down the alert still goes out, with a plain factual sentence
 *     built from the numbers. A missing model must never suppress a real warning.
 */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";

/**
 * A secret from the environment, or from a restricted file when the environment
 * does not carry it.
 *
 * PowerShell's `$env:NAME = "…"` is scoped to that one process. It is not
 * persisted, so a scheduled task, a second terminal or a restarted shell sees
 * nothing at all — which is why a monitor can look correctly configured and
 * still be handed the Cloudflare login page.
 */
function envOrFile(name, fileName) {
  const fromEnv = process.env[name];
  if (typeof fromEnv === "string" && fromEnv.trim()) return { value: fromEnv.trim(), source: "environment" };
  try {
    const fromFile = readFileSync(join(homedir(), ".secrets", fileName), "utf8").trim();
    if (fromFile) return { value: fromFile, source: `~/.secrets/${fileName}` };
  } catch {
    // Absent is a normal state; the caller reports the consequence.
  }
  return { value: "", source: "missing" };
}

const agentCredential = envOrFile("AGENT_API_KEY", "agent-api-key");
const cfClientIdCredential = envOrFile("CF_ACCESS_CLIENT_ID", "cf-access-client-id");
const cfClientSecretCredential = envOrFile("CF_ACCESS_CLIENT_SECRET", "cf-access-client-secret");

const CONFIG = {
  dashboardUrl: (process.env.DASHBOARD_URL || "https://command.merqato.digital").replace(/\/+$/, ""),
  agentKey: agentCredential.value,
  cfClientId: cfClientIdCredential.value,
  cfClientSecret: cfClientSecretCredential.value,
  cfSource: `${cfClientIdCredential.source} / ${cfClientSecretCredential.source}`,
  agentKeySource: agentCredential.source,
  ollamaUrl: (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/+$/, ""),
  ollamaModel: process.env.OLLAMA_MODEL || "qwen2.5-coder:3b",
  intervalMinutes: Number(process.env.INTERVAL_MINUTES || 15),
  loadThreshold: Number(process.env.LOAD_THRESHOLD || 85),
  renotifyHours: Number(process.env.RENOTIFY_HOURS || 6),
  integrations: (process.env.INTEGRATIONS || "github,cloudflare,coolify")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
  stateDir: process.env.MONITOR_STATE_DIR || join(tmpdir(), "merqato-health-monitor"),
};

const STATE_FILE = join(CONFIG.stateDir, "state.json");
const LOG_FILE = join(CONFIG.stateDir, "health-monitor.log");
const REQUEST_TIMEOUT_MS = 30_000;
const OLLAMA_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------- plumbing

function log(event, detail = {}) {
  const line = JSON.stringify({ at: new Date().toISOString(), event, ...detail });
  process.stdout.write(`${line}\n`);
  try {
    mkdirSync(CONFIG.stateDir, { recursive: true });
    appendFileSync(LOG_FILE, `${line}\n`);
  } catch {
    // A full or read-only disk must not stop an alert from being sent.
  }
}

function readState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeState(state) {
  try {
    mkdirSync(CONFIG.stateDir, { recursive: true });
    writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
  } catch (error) {
    log("state.write_failed", { error: String(error) });
  }
}

function dashboardHeaders() {
  const headers = { Authorization: `Bearer ${CONFIG.agentKey}`, Accept: "application/json" };
  if (CONFIG.cfClientId && CONFIG.cfClientSecret) {
    headers["CF-Access-Client-Id"] = CONFIG.cfClientId;
    headers["CF-Access-Client-Secret"] = CONFIG.cfClientSecret;
  }
  return headers;
}

/**
 * Turn a failed response into something that names the actual culprit.
 *
 * The three failures look similar and get confused constantly:
 *   302 / HTML login page  — no service-token headers reached Cloudflare
 *   403 with an "aud" field — a token reached Cloudflare and was refused
 *   401 from the app       — Access let the call through; the bearer was wrong
 *                            or the route is not deployed yet
 */
function describeFailure(status, text) {
  if (status === 403 && /"aud"\s*:/.test(text)) {
    return [
      "Cloudflare Access refused the service token (403).",
      "The header names are correct — the VALUES are not: an expired, rotated or",
      `wrong client-id/secret pair, or a token not attached to this app's policy. Credentials in use: ${CONFIG.cfSource}.`,
    ].join(" ");
  }
  if (status === 401) {
    return `the app rejected the agent bearer. Credentials in use: ${CONFIG.agentKeySource}. If it is present, the route may not be deployed.`;
  }
  if (/^\s*</.test(text)) {
    return CONFIG.cfClientId
      ? "Cloudflare Access answered with its login page (HTML), so the service-token headers were sent but not honoured."
      : "Cloudflare Access answered with its login page (HTML) and no CF_ACCESS_CLIENT_ID was available, so no service-token header was sent.";
  }
  return text.slice(0, 300);
}

async function dashboardJson(path, init = {}) {
  const response = await fetch(`${CONFIG.dashboardUrl}${path}`, {
    ...init,
    headers: { ...dashboardHeaders(), "Content-Type": "application/json", ...(init.headers || {}) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} -> HTTP ${response.status}: ${describeFailure(response.status, text)}`);
  return JSON.parse(text);
}

// ---------------------------------------------------------------- checks

async function checkIntegrations(problems, facts) {
  let payload;
  try {
    payload = await dashboardJson("/api/integrations");
  } catch (error) {
    problems.push({ key: "integrations.unreachable", detail: String(error.message || error) });
    return;
  }

  const rows = Array.isArray(payload?.integrations) ? payload.integrations : [];
  facts.integrations = rows.map((row) => ({ key: row.key, status: row.status, enabled: row.enabled }));

  for (const key of CONFIG.integrations) {
    const row = rows.find((item) => String(item.key).toLowerCase() === key);
    if (!row) {
      problems.push({ key: `integration.${key}.missing`, detail: `${key} is not configured in the dashboard` });
      continue;
    }
    const status = String(row.status || "unknown").toLowerCase();
    if (status !== "connected") {
      problems.push({ key: `integration.${key}.${status}`, detail: `${key} reports status "${status}"` });
    } else if (row.enabled === false) {
      problems.push({ key: `integration.${key}.disabled`, detail: `${key} is connected but disabled` });
    }
  }
}

async function checkHost(problems, facts) {
  let snapshot;
  try {
    snapshot = await dashboardJson("/api/system");
  } catch (error) {
    problems.push({ key: "system.unreachable", detail: String(error.message || error) });
    return;
  }

  const host = snapshot?.host || {};
  const cpu = host.cpu?.percent ?? null;
  const memory = host.memory?.percent ?? null;
  const disk = host.disk?.percent ?? null;
  facts.host = {
    cpuPercent: cpu,
    memoryPercent: memory,
    diskPercent: disk,
    diskFreeGb: host.disk?.freeGb ?? null,
    containers: Array.isArray(snapshot?.containers) ? snapshot.containers.length : null,
    coolifyConnected: snapshot?.coolify?.connected ?? null,
  };

  for (const [label, value] of [["cpu", cpu], ["memory", memory], ["disk", disk]]) {
    if (typeof value === "number" && value > CONFIG.loadThreshold) {
      problems.push({ key: `host.${label}.${Math.floor(value)}`, detail: `${label} at ${value}% (threshold ${CONFIG.loadThreshold}%)` });
    }
  }

  if (facts.host.coolifyConnected === false) {
    problems.push({ key: "system.coolify.disconnected", detail: "the Coolify API is not reachable from the dashboard" });
  }
}

// ---------------------------------------------------------------- wording

function factualSentence(problems, facts) {
  const parts = problems.map((problem) => problem.detail);
  const host = facts.host;
  if (host) {
    parts.push(
      `host cpu ${host.cpuPercent ?? "?"}%, memory ${host.memoryPercent ?? "?"}%, disk ${host.diskPercent ?? "?"}%`,
    );
  }
  return `${problems.length} problem${problems.length === 1 ? "" : "s"} found: ${parts.join("; ")}.`;
}

async function summarise(problems, facts) {
  const fallback = factualSentence(problems, facts);
  if (problems.length === 0) return "All integrations connected and host load within thresholds.";

  const prompt = [
    "You are a monitoring assistant. Write exactly one short sentence (max 30 words) summarising this server health check for the business owner.",
    "Use only the facts below. Do not invent causes, numbers, or recommendations. Plain English.",
    "",
    JSON.stringify({ problems, host: facts.host, integrations: facts.integrations }, null, 2),
  ].join("\n");

  try {
    const response = await fetch(`${CONFIG.ollamaUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: CONFIG.ollamaModel,
        prompt,
        stream: false,
        options: { temperature: 0.2, num_predict: 80 },
      }),
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const text = String(payload?.response || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) throw new Error("empty response");
    // One sentence: collapse to the first sentence terminator.
    const first = /^(.+?[.!?])(\s|$)/.exec(text);
    return (first ? first[1] : text).slice(0, 320);
  } catch (error) {
    log("ollama.unavailable", { error: String(error.message || error), model: CONFIG.ollamaModel });
    return fallback;
  }
}

// ---------------------------------------------------------------- alerting

function fingerprintOf(problems) {
  return problems
    .map((problem) => problem.key)
    .sort()
    .join("|");
}

async function notify(title, body, type) {
  await dashboardJson("/api/notifications", {
    method: "POST",
    body: JSON.stringify({ title, body, type, link: "/system" }),
  });
}

// ---------------------------------------------------------------- one pass

async function runOnce({ dryRun = false } = {}) {
  const problems = [];
  const facts = {};

  if (!CONFIG.agentKey) {
    throw new Error(
      "No agent key: set AGENT_API_KEY, or place it in ~/.secrets/agent-api-key. Without it the dashboard rejects every call.",
    );
  }

  await checkIntegrations(problems, facts);
  await checkHost(problems, facts);

  const fingerprint = fingerprintOf(problems);
  const severity = problems.some((problem) => problem.key.includes("unreachable")) ? "error" : "warning";

  if (problems.length === 0) {
    log("check.ok", { host: facts.host });
    const state = readState();
    writeState({ ...state, lastOkAt: new Date().toISOString(), fingerprint: "", notifiedAt: null });
    return { ok: true, problems, summary: await summarise(problems, facts) };
  }

  const summary = await summarise(problems, facts);
  const state = readState();
  const unchanged = state.fingerprint === fingerprint;
  const lastNotified = state.notifiedAt ? Date.parse(state.notifiedAt) : 0;
  const quiet = unchanged && Number.isFinite(lastNotified) && Date.now() - lastNotified < CONFIG.renotifyHours * 3_600_000;

  log("check.problems", { problems, fingerprint, unchanged, suppressed: quiet });

  if (dryRun) return { ok: false, problems, summary, notified: false, dryRun };

  if (quiet) {
    log("notify.suppressed", { reason: `unchanged within ${CONFIG.renotifyHours}h`, fingerprint });
    return { ok: false, problems, summary, notified: false };
  }

  try {
    await notify(`Health check: ${problems.length} problem${problems.length === 1 ? "" : "s"}`, summary, severity);
    writeState({ ...state, fingerprint, notifiedAt: new Date().toISOString(), lastAlertAt: new Date().toISOString() });
    log("notify.sent", { severity, fingerprint });
    return { ok: false, problems, summary, notified: true };
  } catch (error) {
    log("notify.failed", { error: String(error.message || error) });
    return { ok: false, problems, summary, notified: false, error: String(error.message || error) };
  }
}

// ---------------------------------------------------------------- entry

async function main() {
  const args = new Set(process.argv.slice(2));
  const once = args.has("--once");
  const dryRun = args.has("--dry-run");

  if (once || dryRun) {
    try {
      const result = await runOnce({ dryRun });
      process.exitCode = result.ok ? 0 : 1;
    } catch (error) {
      log("fatal", { error: String(error.message || error) });
      process.exitCode = 2;
    }
    return;
  }

  const intervalMs = Math.max(1, CONFIG.intervalMinutes) * 60_000;
  log("monitor.start", {
    intervalMinutes: CONFIG.intervalMinutes,
    dashboard: CONFIG.dashboardUrl,
    model: CONFIG.ollamaModel,
    threshold: CONFIG.loadThreshold,
    integrations: CONFIG.integrations,
    agentKeyFrom: CONFIG.agentKeySource,
    cfCredentialsFrom: CONFIG.cfSource,
  });

  if (!CONFIG.cfClientId || !CONFIG.cfClientSecret) {
    log("cf.credentials_missing", {
      consequence: "Cloudflare Access will answer with its login page and every check will fail.",
      hint: "Set CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET, or place them in ~/.secrets/cf-access-client-id and ~/.secrets/cf-access-client-secret.",
    });
  }

  // Run immediately, then on a fixed cadence. Each pass is wrapped so a thrown
  // error can never kill the loop and leave the host silently unmonitored.
  const tick = async () => {
    try {
      await runOnce({ dryRun });
    } catch (error) {
      log("check.crashed", { error: String(error.message || error) });
    }
  };

  await tick();
  setInterval(tick, intervalMs);
}

main().catch((error) => {
  log("fatal", { error: String(error.message || error) });
  process.exitCode = 2;
});
