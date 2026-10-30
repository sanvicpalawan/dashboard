/**
 * DeepSeek Harness execution engine for the Palawan Collective agent worker.
 *
 * This is the second engine beside OpenCode. The worker calls runHarnessJob()
 * for jobs whose `agent` column is "marketing"; everything else (claiming,
 * logging, guard rails, retries, scheduling) stays in agent-worker.mjs.
 *
 * Two transports, selected by HARNESS_TRANSPORT:
 *
 *   headless (default)
 *     Spawns `dsh --profile headless --json "<prompt>"` and parses its
 *     newline-delimited event stream. One process per job, no port, no shared
 *     state, exit code 0 = done. This is the documented one-shot mode and it
 *     mirrors how OpenCode is already driven, so it is the safe default.
 *
 *   http
 *     Talks to the running Harness web server (default http://127.0.0.1:3080):
 *     exchanges the launch token for an API cookie at /connect, then submits
 *     the prompt through the Typert RPC bridge (/api/session.create,
 *     /api/session.prompt) and waits for the session to go idle.
 *
 *     READ THIS BEFORE RELYING ON IT:
 *     - The web GUI authenticates with a random per-process launch token that
 *       lives only in memory (PROCESS_LAUNCH_TOKENS in dsh-client-connection).
 *       It is never written to disk, so it can only come from the URL the
 *       server printed at startup. Supply it as HARNESS_API_TOKEN.
 *     - The RPC envelope and argument shapes below were read out of
 *       @deepseek-ai/dsh 0.2.1-rc.5 and are not a published contract. They can
 *       change between release candidates. Every failure returns the raw
 *       response body in the error so a shape change is obvious rather than
 *       silent.
 *     - Jobs submitted this way land in the interactive Harness session list,
 *       shared with whatever you are doing in the GUI, rather than in an
 *       isolated process.
 *
 * Credentials for headless are separate from the GUI: the headless profile
 * ignores the managed credential store, so it needs either DEEPSEEK_API_KEY in
 * the launching environment or the stored-auth patch documented in
 * @deepseek-ai/dsh-headless (three `disabled: false` rows in
 * $DSH_HOME/profiles/headless/cordis.patch.yml). Without one of those every
 * job fails with MISSING_CREDENTIAL before any model call.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const DEFAULT_MAX_OUTPUT = 80_000;

export const HARNESS_TRANSPORT = String(process.env.HARNESS_TRANSPORT || "headless").trim().toLowerCase();
export const HARNESS_API_URL = String(process.env.HARNESS_API_URL || "http://127.0.0.1:3080").replace(/\/+$/, "");

/**
 * Resolves the dsh CLI entry point. The .js entry is used directly so Windows
 * never needs cmd.exe quoting. Both host layouts are checked, because the same
 * worker runs on the workstation and in the Linux container.
 */
export function resolveDsh() {
  const candidates = [
    process.env.DSH_BIN,
    path.join(process.env.APPDATA || "", "npm", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"),
    "/usr/local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js",
    "/usr/lib/node_modules/@deepseek-ai/dsh/lib/bin.js",
    path.join(os.homedir(), ".npm-global", "lib", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"),
  ].filter(Boolean);
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  return null;
}

export function harnessAvailability() {
  if (HARNESS_TRANSPORT === "http") {
    return {
      transport: "http",
      available: Boolean(process.env.HARNESS_API_TOKEN),
      detail: process.env.HARNESS_API_TOKEN
        ? `Harness web server at ${HARNESS_API_URL}`
        : "HARNESS_API_TOKEN is not set; the launch token only exists in the running server's startup URL.",
    };
  }
  const bin = resolveDsh();
  return {
    transport: "headless",
    available: Boolean(bin),
    detail: bin || "dsh was not found. Install it with: npm i -g @deepseek-ai/dsh",
  };
}

function killTree(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    // Nothing useful to do if the process is already gone.
  }
}

/** Trims a stream of events to the tail the database is allowed to keep. */
function makeBuffer(limit) {
  let text = "";
  return {
    append(chunk) {
      text += chunk.endsWith("\n") ? chunk : `${chunk}\n`;
      if (text.length > limit) text = text.slice(-limit);
    },
    get value() {
      return text;
    },
  };
}

/** Best-effort extraction of command-like fields from a tool call, so the worker's deny rules still apply. */
function toolCommand(input) {
  if (!input || typeof input !== "object") return null;
  for (const key of ["command", "cmd", "script", "commandLine"]) {
    if (typeof input[key] === "string") return input[key];
  }
  return null;
}

// ---------------------------------------------------------------------------
// headless transport
// ---------------------------------------------------------------------------

function runHeadless(job, options) {
  const {
    prompt,
    timeoutMs,
    maxOutput = DEFAULT_MAX_OUTPUT,
    guardViolation,
    isCancelled,
    onOutput,
    onSession,
    log = () => {},
  } = options;

  const bin = resolveDsh();
  if (!bin) {
    return Promise.resolve({
      status: "failed",
      output: "",
      result: "",
      error: "dsh was not found. Install it with: npm i -g @deepseek-ai/dsh",
      exitCode: null,
      sessionId: null,
    });
  }

  const startedAt = Date.now();
  const buffer = makeBuffer(maxOutput);
  const append = (line) => {
    buffer.append(line);
    if (onOutput) onOutput(buffer.value);
  };

  let sessionId = job.session_id || null;
  let finalText = "";
  let lastError = "";
  let violation = null;
  let timedOut = false;
  let cancelled = false;

  const args = ["--profile", "headless", "--json"];
  if (job.session_id) args.push("--session-id", job.session_id);
  args.push(prompt);

  log(`harness headless ${job.id} via ${bin}`);
  const child = spawn(process.execPath, [bin, ...args], {
    cwd: job.directory,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NO_COLOR: "1", DSH_RUN_ID: job.id },
  });

  const handleLine = (raw) => {
    const line = raw.trim();
    if (!line) return;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      append(line.slice(0, 400));
      return;
    }

    // The stream always opens with `session` and, on a completed run, closes with `final`.
    if (event.type === "session" && typeof event.sessionId === "string") {
      sessionId = event.sessionId;
      if (onSession) onSession(sessionId);
      append(`> session ${sessionId}`);
      return;
    }
    if (event.type === "text" && typeof event.text === "string") {
      append(event.text);
      return;
    }
    if (event.type === "status") {
      // A turn that fails in-turn reports it here, as turn_end with an error reason,
      // rather than as a separate `error` event. This is where MISSING_CREDENTIAL lands.
      const reasonError = event.reason?.error;
      if (event.reason?.kind === "error" && reasonError) {
        lastError = `${reasonError.code ? `${reasonError.code}: ` : ""}${reasonError.message || "unknown error"}`;
        append(`! ${lastError.slice(0, 800)}`);
        return;
      }
      append(`> ${event.phase || "status"}${event.status ? ` ${typeof event.status === "string" ? event.status : ""}` : ""}`.trimEnd());
      return;
    }
    if (event.type === "tool_call") {
      const name = event.tool || event.name || "tool";
      const command = toolCommand(event.arguments) || toolCommand(event.input);
      if (command && guardViolation) {
        const match = guardViolation(command);
        if (match && !violation) {
          violation = `${match} The job tried to run: ${command.split(/\r?\n/)[0].slice(0, 300)}`;
          append(`> BLOCKED ${command.split(/\r?\n/)[0].slice(0, 300)}`);
          killTree(child);
          return;
        }
      }
      append(`> tool ${name}${command ? `: ${command.split(/\r?\n/)[0].slice(0, 160)}` : ""}`);
      return;
    }
    if (event.type === "tool_result") {
      append("> tool finished");
      return;
    }
    if (event.type === "thinking") return;
    if (event.type === "final") {
      // A turn that fails in-turn still ends with a `final` event, often empty.
      if (typeof event.text === "string" && event.text.trim()) {
        finalText = event.text;
        append("> final answer received");
      }
      return;
    }
    if (event.type === "error") {
      finalText = "";
      lastError = `${event.code ? `${event.code}: ` : ""}${event.message || "unknown error"}`;
      append(`! ${lastError.slice(0, 800)}`);
      return;
    }
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
    // The headless runner writes `dsh: <code>: <message>` diagnostics here.
    if (text) append(`! ${text.slice(0, 400)}`);
  });

  const watchdog = setInterval(() => {
    if (Date.now() - startedAt > timeoutMs) {
      timedOut = true;
      killTree(child);
      return;
    }
    if (isCancelled) isCancelled().then((stop) => { if (stop) { cancelled = true; killTree(child); } }).catch(() => {});
  }, 5000);

  return new Promise((resolve) => {
    child.on("error", (error) => {
      append(`! could not start dsh: ${error.message}`);
      resolve({
        status: "failed",
        output: buffer.value,
        result: "",
        error: `Could not start dsh: ${error.message}`,
        exitCode: -1,
        sessionId,
      });
    });
    child.on("close", (code) => {
      clearInterval(watchdog);
      if (stdoutBuffer.trim()) handleLine(stdoutBuffer);
      const exitCode = code === null ? -1 : code;

      if (violation) {
        return resolve({ status: "blocked", output: buffer.value, result: finalText.slice(0, 6000), error: violation, exitCode, sessionId });
      }
      if (cancelled) {
        return resolve({ status: "cancelled", output: buffer.value, result: finalText.slice(0, 6000), error: null, exitCode, sessionId });
      }
      if (timedOut) {
        return resolve({
          status: "timed_out",
          output: buffer.value,
          result: finalText.slice(0, 6000),
          error: `Timed out after ${Math.round(timeoutMs / 60000)} minutes.`,
          exitCode: -1,
          sessionId,
        });
      }
      if (exitCode === 0) {
        return resolve({ status: "succeeded", output: buffer.value, result: finalText.slice(0, 6000), error: null, exitCode, sessionId });
      }
      const tail = buffer.value.trim().split(/\r?\n/).slice(-6).join(" ").slice(0, 900);
      return resolve({
        status: "failed",
        output: buffer.value,
        result: finalText.slice(0, 6000),
        error: lastError || tail || `dsh exited with code ${exitCode}.`,
        exitCode,
        sessionId,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// http transport
// ---------------------------------------------------------------------------

/** Exchanges the launch token for the signed API cookie. Returns the Cookie header value. */
async function connectApi(token) {
  const response = await fetch(`${HARNESS_API_URL}/connect?token=${encodeURIComponent(token)}&interactions=none`, {
    method: "GET",
    redirect: "manual",
  });
  if (response.status !== 302 && response.status !== 200) {
    const body = await response.text().catch(() => "");
    throw new Error(`Harness /connect returned ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}. The launch token is per-process; copy it from the URL the server printed at startup.`);
  }
  const cookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  if (!cookies.length) throw new Error("Harness /connect returned no session cookie.");
  return cookies.map((entry) => entry.split(";")[0]).join("; ");
}

/** One unary Typert RPC call over the /api bridge. */
async function rpc(cookie, endpoint, args) {
  const rpcId = crypto.randomUUID();
  const response = await fetch(`${HARNESS_API_URL}/api/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ type: "client-request", rpcId, method: endpoint, payload: { args } }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${endpoint} returned HTTP ${response.status}: ${text.slice(0, 400)}`);
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new Error(`${endpoint} returned a non-JSON body: ${text.slice(0, 400)}`);
  }
  if (envelope.rpcId && envelope.rpcId !== rpcId) {
    throw new Error(`${endpoint} replied to a different request (${envelope.rpcId}).`);
  }
  const result = envelope.result || {};
  if (result.ok === false) {
    const error = result.error || {};
    throw new Error(`${endpoint} failed: ${error.code || "unknown"} ${error.message || ""}`.trim());
  }
  return result.value;
}

/** Walks a follow/history payload for assistant text, newest last. Shapes are not a published contract. */
function collectText(node, out) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const item of node) collectText(item, out);
    return out;
  }
  if (node.type === "text" && typeof node.text === "string") out.push(node.text);
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") collectText(value, out);
  }
  return out;
}

async function runHttp(job, options) {
  const { prompt, timeoutMs, maxOutput = DEFAULT_MAX_OUTPUT, onOutput, onSession, isCancelled, log = () => {} } = options;
  const token = process.env.HARNESS_API_TOKEN;
  const buffer = makeBuffer(maxOutput);
  const append = (line) => {
    buffer.append(line);
    if (onOutput) onOutput(buffer.value);
  };

  if (!token) {
    return {
      status: "failed",
      output: "",
      result: "",
      error: "HARNESS_TRANSPORT=http needs HARNESS_API_TOKEN (the ?token= value from the Harness startup URL). The token is generated per process and never written to disk.",
      exitCode: null,
      sessionId: null,
    };
  }

  const startedAt = Date.now();
  let sessionId = job.session_id || null;

  try {
    const cookie = await connectApi(token);
    append(`> connected to ${HARNESS_API_URL}`);

    if (!sessionId) {
      const created = await rpc(cookie, "session.create", { workingDirectory: job.directory });
      sessionId = created?.sessionId || null;
      if (!sessionId) throw new Error("session.create returned no sessionId.");
      if (onSession) onSession(sessionId);
      append(`> session ${sessionId}`);
    }

    await rpc(cookie, "session.prompt", {
      requestId: crypto.randomUUID(),
      sessionId,
      mode: "queue",
      content: [{ type: "text", text: prompt }],
    });
    append("> prompt accepted, waiting for the session to finish");

    // The prompt call is fire-and-forget, so poll the list until the session stops running.
    let finalText = "";
    for (;;) {
      if (Date.now() - startedAt > timeoutMs) {
        return {
          status: "timed_out",
          output: buffer.value,
          result: finalText.slice(0, 6000),
          error: `Timed out after ${Math.round(timeoutMs / 60000)} minutes waiting for the Harness session.`,
          exitCode: null,
          sessionId,
        };
      }
      if (isCancelled) {
        const stop = await isCancelled().catch(() => false);
        if (stop) {
          await rpc(cookie, "session.cancel", { sessionId }).catch(() => {});
          return { status: "cancelled", output: buffer.value, result: finalText.slice(0, 6000), error: null, exitCode: null, sessionId };
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const list = await rpc(cookie, "session.list", {}).catch(() => null);
      const row = list?.items?.find((item) => item.sessionId === sessionId);
      if (!row) {
        append("! the session disappeared from the Harness list");
        break;
      }
      if (row.running) {
        append("> still running");
        continue;
      }
      append("> session idle");
      const follow = await rpc(cookie, "session.follow", {
        address: { kind: "session", sessionId },
        maxMessages: 200,
      }).catch(() => null);
      finalText = collectText(follow, []).join("\n").trim();
      break;
    }

    return {
      status: "succeeded",
      output: buffer.value,
      result: (finalText || `Prompt delivered to Harness session ${sessionId}. The transcript lives in the Harness GUI.`).slice(0, 6000),
      error: null,
      exitCode: 0,
      sessionId,
    };
  } catch (error) {
    append(`! ${error.message}`);
    return {
      status: "failed",
      output: buffer.value,
      result: "",
      error: error.message,
      exitCode: null,
      sessionId,
    };
  }
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

/**
 * Runs one marketing job on the Harness.
 *
 * @param job - the claimed agent_jobs row. `directory` is the working directory and
 *   `session_id` resumes an existing Harness session when present.
 * @param options.prompt - the full instruction, preamble included.
 * @param options.timeoutMs - hard wall-clock limit for the run.
 * @param options.guardViolation - maps a command to a deny reason, or null. Reused from the worker.
 * @param options.isCancelled - resolves true when the operator cancelled the job.
 * @param options.onOutput - called with the output tail, for the periodic database flush.
 * @param options.onSession - called when a session id becomes known.
 * @param options.log - logger.
 * @returns the outcome to hand to finish(): status is one of succeeded, failed,
 *   cancelled, timed_out or blocked.
 */
export async function runHarnessJob(job, options) {
  const startedAt = Date.now();
  const outcome = HARNESS_TRANSPORT === "http"
    ? await runHttp(job, options)
    : await runHeadless(job, options);
  return { ...outcome, durationSeconds: Math.round((Date.now() - startedAt) / 1000) };
}
