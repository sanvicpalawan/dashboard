#!/usr/bin/env node
/**
 * Container health probe for the agent worker.
 *
 * Healthy means both of these are true:
 *   1. the worker heartbeat file was written recently (the loop is alive), and
 *   2. the local Ollama endpoint answers, so a queued job can actually run.
 *
 * Exits 0 when healthy, 1 otherwise. Never prints secrets.
 */
import { readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const file = process.env.AGENT_HEARTBEAT_FILE || path.join(os.tmpdir(), "worker-heartbeat");
const staleSeconds = Number(process.env.AGENT_POLL_SECONDS || 5) * 12 + 30;

function fail(message) {
  console.error(`unhealthy: ${message}`);
  process.exit(1);
}

try {
  const ageSeconds = (Date.now() - statSync(file).mtimeMs) / 1000;
  if (ageSeconds > staleSeconds) fail(`heartbeat is ${Math.round(ageSeconds)}s old (limit ${staleSeconds}s)`);
  const beat = JSON.parse(readFileSync(file, "utf8"));
  if (beat.queuePaused && !beat.runningJobId) {
    console.error("healthy: queue paused by an operator");
    process.exit(0);
  }
} catch (error) {
  fail(`cannot read ${file}: ${error.message}`);
}

try {
  const response = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(5000) });
  if (!response.ok) fail(`ollama answered ${response.status}`);
} catch (error) {
  fail(`ollama unreachable: ${error.message}`);
}

console.log("healthy");
