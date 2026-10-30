#!/usr/bin/env node
/**
 * Palawan Collective agent worker.
 *
 * Polls the Command Center database for queued agent jobs, runs them on the
 * engine the job names, and records progress, results and blockers back into
 * Postgres.
 *
 * Design notes
 * - Two execution engines. `agent` selects one: "script" runs a deterministic
 *   Node script, "marketing" runs the DeepSeek Harness (scripts/harness-engine.mjs),
 *   and anything else runs the local OpenCode CLI. Everything before the spawn —
 *   claim, guard rails, approval, heartbeat, logging, retries, repeat scheduling —
 *   is shared, so an engine only has to run a prompt and return an outcome.
 * - One job at a time. The queue is claimed with FOR UPDATE SKIP LOCKED, so a
 *   second worker instance can never pick up the same job.
 * - The database is the queue. Nothing is lost if this process restarts: a job
 *   left in "running" is recovered after AGENT_STALE_MINUTES of silence.
 * - Guard rails live in config/agent-policy.json and are enforced here as well
 *   as in the dashboard API. A guarded job stays in "awaiting_approval".
 * - Output is streamed to the job row in the tail only, so a chatty job cannot
 *   bloat the database.
 *
 * Usage: node scripts/agent-worker.mjs
 *        node scripts/agent-worker.mjs --once     (process a single job and exit)
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import pg from "pg";
import { harnessAvailability, runHarnessJob } from "./harness-engine.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
loadEnv({ path: path.join(repoRoot, ".env.local"), quiet: true });

const DATABASE_URL = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("[agent-worker] DATABASE_URL is not set. Add it to .env.local.");
  process.exit(1);
}

const POLL_MS = Math.max(2, Number(process.env.AGENT_POLL_SECONDS || 5)) * 1000;
const TIMEOUT_MS = Math.max(1, Number(process.env.AGENT_TIMEOUT_MINUTES || 45)) * 60_000;
const STALE_MINUTES = Math.max(2, Number(process.env.AGENT_STALE_MINUTES || 10));
const DEFAULT_MODEL = process.env.AGENT_MODEL || null;
const ONCE = process.argv.includes("--once");
const MAX_OUTPUT = 80_000;
const SCRIPT_TIMEOUT_MS = Math.max(5, Number(process.env.AGENT_SCRIPT_TIMEOUT_MINUTES || 30)) * 60_000;
const MAX_RESULT = 6_000;
const PID_FILE = path.join(repoRoot, ".agent-worker.pid");
const WORKER_NAME = `${os.hostname()}#${process.pid}`;
/** File heartbeat for container health checks; the database heartbeat stays authoritative. */
const HEARTBEAT_FILE = process.env.AGENT_HEARTBEAT_FILE || path.join(os.tmpdir(), "worker-heartbeat");

// ---------------------------------------------------------------------------
// Guard rails (mirrors src/lib/agent-policy.ts)
// ---------------------------------------------------------------------------

function loadPolicy() {
  const fallback = { allowedRoots: ["C:\\dev"], dangerPatterns: [] };
  try {
    const parsed = JSON.parse(readFileSync(path.join(repoRoot, "config", "agent-policy.json"), "utf8"));
    return {
      allowedRoots: Array.isArray(parsed.allowedRoots) ? parsed.allowedRoots : fallback.allowedRoots,
      dangerPatterns: Array.isArray(parsed.dangerPatterns) ? parsed.dangerPatterns : [],
    };
  } catch (error) {
    console.warn(`[agent-worker] Could not read config/agent-policy.json (${error.message}). Using the built-in allowlist.`);
    return fallback;
  }
}

const policy = loadPolicy();

/**
 * Where jobs run when they do not name a directory that is usable here.
 *
 * Windows and the Linux worker container must agree on the same rule, so this is
 * configuration, never a hardcoded drive letter. Created on startup below.
 */
const WORKSPACE_DIR = (process.env.AGENT_WORKSPACE_DIR || "").trim() || path.join(repoRoot, ".agent-workspace");

const allowedRoots = [...new Set([
  ...policy.allowedRoots,
  ...String(process.env.AGENT_ALLOWED_ROOTS || "").split(";").map((entry) => entry.trim()).filter(Boolean),
  WORKSPACE_DIR,
])];

/** A Windows drive or UNC path, which is absolute even when read on Linux. */
const isAbsoluteAnywhere = (value) => {
  const target = String(value || "").trim();
  if (!target) return false;
  return path.isAbsolute(target) || /^[A-Za-z]:[\\/]/.test(target) || /^\\\\[^\\]/.test(target);
};

/** Normalises for comparison without assuming this host's separator or platform. */
const normalise = (value) => {
  const raw = String(value || "").trim();
  const windowsish = /^[A-Za-z]:[\\/]/.test(raw) || /^\\\\[^\\]/.test(raw);
  const resolved = windowsish ? raw : path.resolve(raw);
  return resolved.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
};

/** True when the path belongs to the other OS, so it cannot exist on this host. */
const isForeignPlatformPath = (value) => {
  const raw = String(value || "").trim();
  return process.platform === "win32"
    ? /^\/(?!\/)/.test(raw)
    : /^[A-Za-z]:[\\/]/.test(raw) || /^\\\\/.test(raw);
};

function directoryAllowed(directory) {
  if (!isAbsoluteAnywhere(directory)) return "The working directory must be an absolute path.";
  const target = normalise(directory);
  const inside = allowedRoots.map(normalise).some((root) => target === root || target.startsWith(`${root}/`));
  if (!inside) return `That directory is outside the agent allowlist (${allowedRoots.join(", ")}).`;
  if (!existsSync(directory)) return "That directory does not exist on this machine.";
  return null;
}

/**
 * Turns whatever the dashboard stored into a directory this host can actually use.
 * A relative path, or one written for the other operating system, falls back to
 * the worker workspace instead of failing the job with a path error nobody can act on.
 */
function resolveJobDirectory(directory) {
  const raw = String(directory || "").trim();
  if (!raw) return { directory: WORKSPACE_DIR, reason: "no directory was set" };
  if (!isAbsoluteAnywhere(raw)) return { directory: WORKSPACE_DIR, reason: `${raw} is not absolute` };
  if (isForeignPlatformPath(raw)) return { directory: WORKSPACE_DIR, reason: `${raw} belongs to another operating system` };
  return { directory: raw, reason: null };
}

/** The workspace must exist before the first job claims it. */
function ensureWorkspace() {
  try {
    mkdirSync(WORKSPACE_DIR, { recursive: true });
  } catch (error) {
    log(`could not create workspace ${WORKSPACE_DIR}: ${error.message}`);
  }
}

function guardReasons(text) {
  const reasons = [];
  for (const rule of policy.dangerPatterns) {
    try {
      if (new RegExp(rule.pattern, "i").test(text)) reasons.push(rule.reason);
    } catch {
      // Ignore a malformed rule rather than blocking work silently.
    }
  }
  return [...new Set(reasons)];
}

/** Compiles the deny list once, so every tool call can be checked cheaply. */
const guardRules = policy.dangerPatterns.flatMap((rule) => {
  try {
    return [{ id: rule.id, reason: rule.reason, regex: new RegExp(rule.pattern, "i") }];
  } catch {
    return [];
  }
});

/** Returns the first matched deny rule for a command the agent is about to run. */
function guardViolation(command) {
  if (!command) return null;
  return guardRules.find((rule) => rule.regex.test(command)) || null;
}

// ---------------------------------------------------------------------------
// OpenCode binary resolution
// ---------------------------------------------------------------------------

function resolveOpencode() {
  const candidates = [
    process.env.OPENCODE_BIN,
    path.join(process.env.APPDATA || "", "npm", "node_modules", "@opencode", "cli", "bin", "opencode.exe"),
  ].filter(Boolean);
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  const viaAppData = path.join(os.homedir(), ".local", "bin", "opencode");
  if (existsSync(viaAppData)) return viaAppData;
  return "opencode";
}

const OPENCODE_BIN = resolveOpencode();

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

const clientConfig = {
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("neon.tech") || /sslmode=require/.test(DATABASE_URL) ? { rejectUnauthorized: false } : undefined,
  application_name: "palawan-agent-worker",
};

/** Neon can be asleep or the network can be down at logon. Retry instead of dying silently. */
let client = new pg.Client(clientConfig);

async function connectWithRetry(attempts = 12, delayMs = 10_000) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await client.connect();
      return;
    } catch (error) {
      log(`database connect failed (${attempt}/${attempts}): ${error.message}`);
      if (attempt === attempts) throw error;
      client = new pg.Client(clientConfig);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

const log = (...args) => console.log(new Date().toISOString(), ...args);

async function heartbeat(state = {}) {
  const value = {
    worker: WORKER_NAME,
    hostname: os.hostname(),
    pid: process.pid,
    startedAt: STARTED_AT,
    lastSeen: new Date().toISOString(),
    runningJobId: state.runningJobId ?? null,
    pollSeconds: Math.round(POLL_MS / 1000),
    opencodeVersion: OPENCODE_VERSION,
    model: DEFAULT_MODEL,
    harness: harnessAvailability(),
    queuePaused: state.queuePaused === true,
  };
  await client.query(
    `insert into app_settings (key, value, updated_at) values ($1, $2::jsonb, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    ["agent.worker.heartbeat", JSON.stringify(value)],
  );
  try {
    writeFileSync(HEARTBEAT_FILE, JSON.stringify(value), "utf8");
  } catch (error) {
    log(`could not write heartbeat file ${HEARTBEAT_FILE}: ${error.message}`);
  }
}

/** Claims one queued job. Safe against a second worker running at the same time. */
async function claim() {
  const { rows } = await client.query(
    `update agent_jobs set
        status = 'running',
        attempts = attempts + 1,
        started_at = now(),
        heartbeat_at = now(),
        finished_at = null,
        worker = $1,
        error = null,
        exit_code = null,
        output = '',
        updated_at = now()
     where id = (
       select id from agent_jobs
       where status = 'queued' and run_at <= now()
       order by priority asc, created_at asc
       for update skip locked
       limit 1
     )
     returning *`,
    [WORKER_NAME],
  );
  return rows[0] || null;
}

/** Re-queues jobs whose worker died mid-run. */
async function recoverStale() {
  const { rows } = await client.query(
    `update agent_jobs set
        status = case when attempts >= max_attempts then 'failed' else 'queued' end,
        error = case when attempts >= max_attempts
                 then 'Worker stopped responding and the retry budget was exhausted.'
                 else 'Worker stopped responding; job returned to the queue.' end,
        finished_at = case when attempts >= max_attempts then now() else null end,
        run_at = now() + interval '15 seconds',
        updated_at = now()
     where status = 'running'
       and coalesce(heartbeat_at, started_at, created_at) < now() - ($1 || ' minutes')::interval
     returning id, status`,
    [String(STALE_MINUTES)],
  );
  for (const row of rows) log(`recovered stale job ${row.id} -> ${row.status}`);
  return rows.length;
}

/** Cancels are honoured by the worker, not just recorded by the dashboard. */
async function isCancelled(id) {
  const { rows } = await client.query("select status from agent_jobs where id = $1", [id]);
  return rows[0]?.status === "cancelled";
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

let OPENCODE_VERSION = null;
let STARTED_AT = new Date().toISOString();
let shuttingDown = false;

async function readOpencodeVersion() {
  return new Promise((resolve) => {
    let output = "";
    const child = spawn(OPENCODE_BIN, ["--version"], { cwd: repoRoot, windowsHide: true });
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.on("error", () => resolve(null));
    child.on("close", () => resolve(output.trim().split(/\r?\n/).pop() || null));
  });
}

function killTree(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    } else {
      child.kill("SIGTERM");
    }
  } catch (error) {
    log(`could not stop job process: ${error.message}`);
  }
}

/**
 * Prepended to every job instruction. This is guidance the agent follows; the
 * hard enforcement is in guardViolation() below, which stops the job process the
 * moment a denied command appears in the stream.
 */
const JOB_PREAMBLE = [
  "You are running as an unattended job from the Palawan Collective Command Center, on the owner's machine.",
  "Work only inside this directory. Do not modify other repositories.",
  "You may: read and edit files here, run builds/linters/tests, create a feature branch, commit, and push that branch to the existing remote.",
  "You must not: force-push, delete remote branches, delete repositories, drop or truncate databases, delete files outside this task, deploy to production, change DNS, or spend money.",
  "If the task genuinely needs one of those, stop and reply with a line starting BLOCKED and say what approval is needed.",
  "Finish with a short report: what changed, checks run and results, branch and commit, anything unfinished.",
  "For brand analysis, use browseros-neo to read the client's website. Call the browser directly — do not use terminal commands (pwsh, glob, search, etc.) to find it.",
].join("\n");

const SCRIPT_ROOT = path.join(repoRoot, "scripts");

/**
 * `job.instructions` names one script below scripts/, e.g. "scripts/nightly/leads-verify.mjs".
 * A bare file name is read as a nightly script. Paths that escape scripts/ are rejected.
 */
function scriptFile(job) {
  const raw = String(job.instructions || "").trim().split(/\s+/)[0];
  const name = raw.startsWith("scripts/") ? raw : `scripts/nightly/${raw}`;
  if (!/^scripts\/[a-z0-9][a-z0-9/.-]*\.mjs$/.test(name) || name.includes("..")) return null;
  const resolved = path.join(repoRoot, name);
  return resolved.startsWith(`${SCRIPT_ROOT}${path.sep}`) ? resolved : null;
}

/**
 * Runs a deterministic nightly script. These never touch a model: every value they
 * write comes from a direct check that either answered or did not.
 */
async function runScriptJob(job) {
  const startedAt = Date.now();
  const file = scriptFile(job);
  if (!file || !existsSync(file)) {
    await finish(job, { status: "failed", error: `Unknown script: "${job.instructions}". Expected a file below scripts/.`, output: "" });
    return;
  }

  const name = path.basename(file);
  log(`script ${job.id} ${name}`);
  let output = "";
  const append = (line) => {
    output = `${output}${line}\n`.slice(-MAX_OUTPUT);
  };

  const child = spawn(process.execPath, [file], {
    cwd: repoRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NO_COLOR: "1" },
  });

  child.stdout.on("data", (chunk) => append(chunk.toString("utf8").trimEnd()));
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString("utf8").trimEnd();
    if (text) append(`! ${text}`);
  });

  const flush = setInterval(() => {
    client.query("update agent_jobs set output = $2, heartbeat_at = now(), updated_at = now() where id = $1", [job.id, output]).catch(() => {});
  }, 4000);

  const watchdog = setInterval(() => {
    if (Date.now() - startedAt > SCRIPT_TIMEOUT_MS) {
      append(`! timed out after ${Math.round(SCRIPT_TIMEOUT_MS / 60000)} minutes`);
      killTree(child);
    }
  }, 5000);

  const exitCode = await new Promise((resolve) => {
    child.on("error", (error) => { append(`! could not start node: ${error.message}`); resolve(-1); });
    child.on("close", (code) => resolve(code === null ? -1 : code));
  });

  clearInterval(flush);
  clearInterval(watchdog);

  const durationSeconds = Math.round((Date.now() - startedAt) / 1000);
  const tail = output.trim().split(/\r?\n/).slice(-6).join(" ").slice(0, 900);
  await finish(job, {
    status: exitCode === 0 ? "succeeded" : retryOrFail(job),
    error: exitCode === 0 ? null : tail || `${name} exited with code ${exitCode}.`,
    output,
    exitCode,
    result: tail,
    durationSeconds,
  });
}

/**
 * Runs a marketing job on the DeepSeek Harness.
 *
 * Everything that makes a job safe — the directory allowlist, the deny rules,
 * approval, cancellation and the hard timeout — is enforced here and inside
 * scripts/harness-engine.mjs. This function only owns the queue bookkeeping:
 * throttled log flushing, the session id, and mapping the engine's outcome
 * onto a job status.
 */
async function runMarketingJob(job) {
  const availability = harnessAvailability();
  if (!availability.available) {
    await finish(job, { status: "failed", error: `The Harness engine is not available: ${availability.detail}`, output: "" });
    return;
  }
  log(`marketing ${job.id} ${availability.transport} ${job.directory}`);

  let output = "";
  const flush = setInterval(() => {
    client.query("update agent_jobs set output = $2, heartbeat_at = now(), updated_at = now() where id = $1", [job.id, output]).catch(() => {});
  }, 4000);

  let outcome;
  try {
    outcome = await runHarnessJob(job, {
      prompt: `${JOB_PREAMBLE}\n\nTask:\n${job.instructions}`,
      timeoutMs: TIMEOUT_MS,
      maxOutput: MAX_OUTPUT,
      // The worker's deny rules take precedence; the engine only reports the command.
      guardViolation: (command) => guardViolation(command)?.reason || null,
      isCancelled: () => isCancelled(job.id),
      onOutput: (value) => { output = value; },
      onSession: (sessionId) => {
        client.query("update agent_jobs set session_id = $2 where id = $1", [job.id, sessionId]).catch(() => {});
      },
      log,
    });
  } finally {
    clearInterval(flush);
  }

  output = outcome.output || output;
  let status = outcome.status === "succeeded" ? "succeeded"
    : outcome.status === "cancelled" ? "cancelled"
    : outcome.status === "blocked" ? "failed"
    : retryOrFail(job);

  // For marketing jobs tied to a client, parse the Harness JSON result and
  // persist it to clients.brand_profile instead of leaving it as log text.
  let parsedProfile = null;
  if (status === "succeeded" && job.clientId) {
    try {
      const raw = String(outcome.result || output || "").trim();
      // Strip accidental markdown fences if present.
      const cleaned = raw.replace(/^```(?:json)?\\s*/i, "").replace(/```\\s*$/i, "").trim();
      const jsonMatch = cleaned.match(/\\{[\\s\\S]*\\}/);
      const candidate = jsonMatch ? jsonMatch[0] : cleaned;
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        parsedProfile = parsed;
      } else {
        throw new Error("Harness result was not a JSON object.");
      }
    } catch (error) {
      status = "failed";
      outcome.error = `Brand analysis did not return valid JSON: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  if (status === "succeeded" && parsedProfile && job.clientId) {
    try {
      await client.query("update clients set brand_profile = $1::jsonb, updated_at = now() where id = $2", [JSON.stringify(parsedProfile), job.clientId]);
    } catch (error) {
      status = "failed";
      outcome.error = `Failed to save brand profile: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  await finish(job, {
    status,
    error: status === "succeeded" || status === "cancelled" ? null : (outcome.error || null),
    output,
    exitCode: outcome.exitCode,
    sessionId: outcome.sessionId,
    result: outcome.result,
    durationSeconds: outcome.durationSeconds,
  });
}

async function runJob(job) {
  const startedAt = Date.now();
  log(`start ${job.id} "${job.title}" in ${job.directory}`);

  // Deterministic jobs are plain Node scripts: no model, no prompt, no credits.
  if (job.agent === "script") {
    await runScriptJob(job);
    return;
  }

  // Guard rails are re-checked at execution time; the API cannot be the only gate.
  // A directory written for another operating system is mapped to this host's
  // workspace rather than failing the job on a path nobody can fix from the UI.
  const resolved = resolveJobDirectory(job.directory);
  if (resolved.reason) log(`directory fallback for ${job.id}: ${resolved.reason} -> ${resolved.directory}`);
  job.directory = resolved.directory;
  const directoryProblem = directoryAllowed(job.directory);
  if (directoryProblem) {
    await finish(job, { status: "failed", error: directoryProblem, output: "" });
    return;
  }
  // The workspace may not exist yet on a fresh container or a new machine.
  try {
    mkdirSync(job.directory, { recursive: true });
  } catch (error) {
    await finish(job, { status: "failed", error: `Could not create the job directory ${job.directory}: ${error.message}`, output: "" });
    return;
  }
  const reasons = guardReasons(`${job.title}\n${job.instructions}`);
  if (reasons.length && job.approval !== "approved") {
    await finish(job, { status: "awaiting_approval", error: reasons.join(" "), output: "" });
    return;
  }

  // Marketing work runs on the Harness, not OpenCode. Same guard rails, same
  // queue, same log — only the engine behind the prompt changes.
  if (job.agent === "marketing") {
    await runMarketingJob(job);
    return;
  }

  const args = ["run", "--format", "json", "--auto"];
  const model = job.model || DEFAULT_MODEL;
  if (model) args.push("--model", model);
  if (job.agent && !["build", "default"].includes(job.agent)) args.push("--agent", job.agent);
  args.push("--title", job.title.slice(0, 120));
  args.push(`${JOB_PREAMBLE}\n\nTask:\n${job.instructions}`);

  let output = "";
  let lastText = "";
  let sessionId = job.session_id || null;
  let timedOut = false;
  let cancelled = false;
  let violation = null;

  const child = spawn(OPENCODE_BIN, args, {
    cwd: job.directory,
    windowsHide: true,
    // stdin must be closed: OpenCode's CLI reads piped stdin and would block forever.
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, OPENCODE_RUN_ID: job.id, NO_COLOR: "1" },
  });

  const append = (line) => {
    output += line.endsWith("\n") ? line : `${line}\n`;
    if (output.length > MAX_OUTPUT) output = output.slice(-MAX_OUTPUT);
  };

  const handleLine = (raw) => {
    const line = raw.trim();
    if (!line) return;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      append(line);
      return;
    }
    if (event.sessionID && !sessionId) sessionId = event.sessionID;
    const part = event.part || {};
    if (event.type === "text" && typeof part.text === "string") {
      lastText = part.text;
      append(part.text);
      return;
    }
    if (event.type === "step_start") { append("> step started"); return; }
    if (event.type === "step_finish") { append("> step finished"); return; }
    if (part.type === "tool" || event.type === "tool") {
      const name = part.tool || part.name || "tool";
      const state = part.state || {};
      const input = state.input && typeof state.input === "object" ? state.input : {};
      const command = typeof input.command === "string" ? input.command : typeof input.cmd === "string" ? input.cmd : null;
      const match = guardViolation(command);
      if (match && !violation) {
        violation = `${match.reason} The job tried to run: ${command.split(/\r?\n/)[0].slice(0, 300)}`;
        append(`> BLOCKED ${match.id}: ${command.split(/\r?\n/)[0].slice(0, 300)}`);
        killTree(child);
        return;
      }
      append(`> tool ${name}${command ? `: ${command.split(/\r?\n/)[0].slice(0, 160)}` : state.status ? ` (${state.status})` : ""}`);
      return;
    }
    if (event.type === "error" || event.error) {
      append(`> error ${JSON.stringify(event.error || event).slice(0, 800)}`);
      return;
    }
    if (event.type === "reasoning") return;
    append(line.length > 400 ? `${line.slice(0, 400)}...` : line);
  };

  let stdoutBuffer = "";
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString("utf8");
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() || "";
    for (const line of lines) handleLine(line);
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString("utf8").trim();
    if (text) append(`! ${text.slice(0, 400)}`);
  });

  // Stream the tail to the database so the dashboard can follow along.
  const flush = setInterval(() => {
    client.query("update agent_jobs set output = $2, session_id = coalesce($3, session_id), heartbeat_at = now(), updated_at = now() where id = $1",
      [job.id, output.slice(-MAX_OUTPUT), sessionId]).catch(() => {});
  }, 4000);

  // Watch for operator cancellation and enforce the hard timeout.
  const watchdog = setInterval(() => {
    if (Date.now() - startedAt > TIMEOUT_MS) { timedOut = true; killTree(child); return; }
    isCancelled(job.id).then((stop) => { if (stop) { cancelled = true; killTree(child); } }).catch(() => {});
  }, 5000);

  const exitCode = await new Promise((resolve) => {
    child.on("error", (error) => { append(`! could not start OpenCode: ${error.message}`); resolve(-1); });
    child.on("close", (code) => resolve(code === null ? -1 : code));
  });

  clearInterval(flush);
  clearInterval(watchdog);
  if (stdoutBuffer.trim()) handleLine(stdoutBuffer);

  // One last write so the dashboard has the full picture.
  await client.query("update agent_jobs set output = $2, session_id = coalesce($3, session_id) where id = $1", [job.id, output.slice(-MAX_OUTPUT), sessionId]).catch(() => {});

  const durationSeconds = Math.round((Date.now() - startedAt) / 1000);

  // A denied command stops the job immediately, whatever the exit code says.
  if (violation) {
    await finish(job, { status: "failed", error: violation, output, exitCode, sessionId, result: lastText.slice(0, MAX_RESULT), durationSeconds });
    return;
  }
  if (cancelled) {
    await finish(job, { status: "cancelled", error: job.error || null, output, exitCode, sessionId, result: lastText.slice(0, MAX_RESULT), durationSeconds });
    return;
  }
  if (timedOut) {
    await finish(job, { status: retryOrFail(job), error: `Timed out after ${Math.round(TIMEOUT_MS / 60000)} minutes.`, output, exitCode: -1, sessionId, durationSeconds });
    return;
  }
  if (exitCode === 0) {
    await finish(job, { status: "succeeded", error: null, output, exitCode, sessionId, result: lastText.slice(0, MAX_RESULT), durationSeconds });
    return;
  }
  const tail = output.trim().split(/\r?\n/).slice(-6).join(" ").slice(0, 900);
  await finish(job, { status: retryOrFail(job), error: tail || `OpenCode exited with code ${exitCode}.`, output, exitCode, sessionId, result: lastText.slice(0, MAX_RESULT), durationSeconds });
}

function retryOrFail(job) {
  return job.attempts < job.max_attempts ? "queued" : "failed";
}

/** Re-queues the next occurrence of a repeating job. Called only for terminal results. */
async function scheduleNextRun(job) {
  if (!job.repeat_minutes || job.repeat_minutes <= 0) return;
  const { rows } = await client.query(
    `insert into agent_jobs (
        workspace_id, created_by, created_by_name, project_id, title, instructions,
        directory, agent, model, status, approval, max_attempts, repeat_minutes, schedule_key,
        attempts, run_at
     )
     select $1::uuid, $2::uuid, $3::text, $4::uuid, $5::text, $6::text, $7::text, $8::text, $9::text,
            'queued', $10::text, $11::int, $12::int, $13::text,
            0, case when $8::text = 'script'
                    then (date_trunc('day', now() at time zone 'Asia/Manila')
                          + case when (now() at time zone 'Asia/Manila')::time < time '02:00'
                                 then interval '2 hours' else interval '26 hours' end) at time zone 'Asia/Manila'
                    else now() + make_interval(mins => $12::int) end
     where $13::text is null
        or not exists (
          select 1 from agent_jobs
          where schedule_key = $13::text and status in ('queued', 'running')
        )
     returning id`,
    [
      job.workspace_id, job.created_by, job.created_by_name, job.project_id, job.title, job.instructions,
      job.directory, job.agent, job.model, job.approval, job.max_attempts, job.repeat_minutes, job.schedule_key,
    ],
  );
  if (rows[0]) log(`[worker] scheduled next run of ${job.title} in ${job.repeat_minutes} minutes (job ${rows[0].id})`);
  else log(`[worker] skipped next run of ${job.title}: one is already queued or running`);
}

async function finish(job, { status, error, output, exitCode = null, sessionId = null, result = "", durationSeconds = null }) {
  const retry = status === "queued";
  await client.query(
    `update agent_jobs set
        status = $2,
        error = $3,
        output = $4,
        exit_code = $5,
        session_id = coalesce($6, session_id),
        result = $7,
        finished_at = case when $2 = 'queued' then null else now() end,
        run_at = case when $2 = 'queued' then now() + interval '20 seconds' else run_at end,
        updated_at = now()
      where id = $1`,
    [job.id, status, error, output.slice(-MAX_OUTPUT), exitCode, sessionId, result],
  );
  log(`done ${job.id} -> ${status}${durationSeconds !== null ? ` in ${durationSeconds}s` : ""}${retry ? " (retrying)" : ""}`);
  if (!retry) {
    try {
      await scheduleNextRun(job);
    } catch (scheduleError) {
      log(`could not schedule next run of ${job.title}: ${scheduleError.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

function acquireLock() {
  if (existsSync(PID_FILE)) {
    const existing = Number(readFileSync(PID_FILE, "utf8").trim());
    if (existing && existing !== process.pid) {
      try {
        process.kill(existing, 0);
        console.error(`[agent-worker] Another worker is already running (pid ${existing}). Exiting.`);
        process.exit(0);
      } catch {
        // Stale pid file from a crashed worker; take over.
      }
    }
  }
  writeFileSync(PID_FILE, String(process.pid), "utf8");
  const release = () => { try { if (Number(readFileSync(PID_FILE, "utf8").trim()) === process.pid) unlinkSync(PID_FILE); } catch {} };
  process.on("exit", release);
  process.on("SIGINT", () => { shuttingDown = true; release(); process.exit(0); });
  process.on("SIGTERM", () => { shuttingDown = true; release(); process.exit(0); });
}

async function main() {
  acquireLock();
  ensureWorkspace();
  await connectWithRetry();
  STARTED_AT = new Date().toISOString();
  OPENCODE_VERSION = await readOpencodeVersion();
  log(`worker ${WORKER_NAME} online. OpenCode ${OPENCODE_VERSION || "unknown"}, poll ${POLL_MS / 1000}s, timeout ${TIMEOUT_MS / 60000}m`);
  const harness = harnessAvailability();
  log(`harness: ${harness.transport} - ${harness.available ? "ready" : "not available"} (${harness.detail})`);
  log(`allowlist: ${allowedRoots.join(", ")}`);
  log(`workspace: ${WORKSPACE_DIR}`);

  await heartbeat({ queuePaused: false });

  let idlePolls = 0;
  while (!shuttingDown) {
    try {
      if (idlePolls % 12 === 0) await recoverStale();
      const job = await claim();
      if (!job) {
        idlePolls += 1;
        await heartbeat({ queuePaused: false });
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        continue;
      }
      idlePolls = 0;
      await heartbeat({ runningJobId: job.id });
      await runJob(job);
      await heartbeat({ queuePaused: false });
      if (ONCE) break;
    } catch (error) {
      log(`loop error: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, Math.min(POLL_MS * 4, 30_000)));
    }
  }

  await client.end().catch(() => {});
  log("worker stopped");
}

// Exported so the path rules can be tested on both operating systems without
// starting a worker. Running the file directly still starts it.
export { WORKSPACE_DIR, directoryAllowed, resolveJobDirectory, isAbsoluteAnywhere, normalise };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(async (error) => {
    console.error("[agent-worker] fatal:", error);
    await client.end().catch(() => {});
    process.exit(1);
  });
}
