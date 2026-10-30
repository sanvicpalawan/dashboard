import { readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Agent queue policy.
 *
 * The same rules are enforced twice: here when a job is created (fast, readable
 * feedback) and in scripts/agent-worker.mjs before anything is executed. Both
 * read config/agent-policy.json so the allowlist and the guard patterns cannot
 * drift apart.
 */

export const AGENT_STATUSES = ["queued", "awaiting_approval", "running", "succeeded", "failed", "cancelled"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const AGENT_STATUS_LABELS: Record<AgentStatus, string> = {
  queued: "Queued",
  awaiting_approval: "Awaiting approval",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const ACTIVE_AGENT_STATUSES: AgentStatus[] = ["queued", "awaiting_approval", "running"];

type PolicyFile = {
  allowedRoots: string[];
  dangerPatterns: { id: string; pattern: string; reason: string }[];
};

const FALLBACK: PolicyFile = { allowedRoots: ["C:\\dev"], dangerPatterns: [] };

let cached: PolicyFile | null = null;

export function agentPolicy(): PolicyFile {
  if (cached) return cached;
  try {
    const raw = readFileSync(path.join(process.cwd(), "config", "agent-policy.json"), "utf8");
    const parsed = JSON.parse(raw) as PolicyFile;
    cached = {
      allowedRoots: Array.isArray(parsed.allowedRoots) ? parsed.allowedRoots : FALLBACK.allowedRoots,
      dangerPatterns: Array.isArray(parsed.dangerPatterns) ? parsed.dangerPatterns : [],
    };
  } catch {
    cached = FALLBACK;
  }
  return cached;
}

/**
 * Roots that exist on the worker host, not inside this web container.
 *
 * When the worker runs on another machine (for example a Coolify container with a
 * mounted /workspace), the web container cannot stat those paths. Existence is
 * verified by the worker itself before it starts a job, so the API only checks
 * the allowlist here.
 */
export function remoteRoots() {
  return (process.env.AGENT_REMOTE_ROOTS || "").split(";").map((entry) => entry.trim()).filter(Boolean);
}

/**
 * The directory the app hands to the worker when a job does not name one.
 *
 * Jobs execute on the worker host, which may be Windows or a Linux container,
 * so this is never hardcoded: `AGENT_WORKSPACE_DIR` wins, otherwise a
 * `.agent-workspace` folder beside the app. The worker creates it on startup.
 */
export function defaultWorkspaceDir() {
  const configured = (process.env.AGENT_WORKSPACE_DIR || "").trim();
  if (configured) return configured;
  return path.join(process.cwd(), ".agent-workspace");
}

export function allowedRoots() {
  const extra = (process.env.AGENT_ALLOWED_ROOTS || "").split(";").map((entry) => entry.trim()).filter(Boolean);
  return [...new Set([...agentPolicy().allowedRoots, ...extra, ...remoteRoots(), defaultWorkspaceDir()])];
}

/** A Windows drive or UNC path, which is absolute even when read on Linux. */
export function isAbsoluteAnywhere(value: string) {
  const target = (value || "").trim();
  if (!target) return false;
  return path.isAbsolute(target) || /^[A-Za-z]:[\\/]/.test(target) || /^\\\\[^\\]/.test(target);
}

/**
 * Normalises a path for prefix comparison, without assuming the current host's
 * platform: `C:\dev\x` and `C:/dev/x` must compare equal on Linux too.
 */
function normalise(value: string) {
  const raw = (value || "").trim();
  const windowsish = /^[A-Za-z]:[\\/]/.test(raw) || /^\\\\[^\\]/.test(raw);
  const resolved = windowsish ? raw : path.resolve(raw);
  return resolved.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function checkDirectory(directory: string): { ok: boolean; error?: string } {
  const value = (directory || "").trim();
  if (!value) return { ok: false, error: "A working directory is required." };
  if (!isAbsoluteAnywhere(value)) return { ok: false, error: "The working directory must be an absolute path." };
  const target = normalise(value);
  const roots = allowedRoots().map(normalise);
  const inside = roots.some((root) => target === root || target.startsWith(`${root}/`));
  if (!inside) return { ok: false, error: `That directory is outside the agent allowlist (${allowedRoots().join(", ")}). Add it to config/agent-policy.json to permit it.` };
  // A remote root lives on the worker host. The worker verifies it before running.
  const workerSide = [...remoteRoots(), defaultWorkspaceDir()].map(normalise);
  if (workerSide.some((root) => target === root || target.startsWith(`${root}/`))) return { ok: true };
  // A path that cannot exist on this host (a Windows drive on Linux, or the
  // reverse) is executed by the worker, which checks existence itself.
  const foreignHost = process.platform === "win32"
    ? /^\/(?!\/)/.test(value)
    : /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value);
  if (foreignHost) return { ok: true };
  try {
    const stat = statSync(value);
    if (!stat.isDirectory()) return { ok: false, error: "That path is not a directory." };
  } catch {
    return { ok: false, error: "That directory does not exist on this machine." };
  }
  return { ok: true };
}

/** Consequential instructions are not refused, they are held for human approval. */
export function checkInstructions(text: string): { blocked: boolean; reasons: string[] } {
  const reasons: string[] = [];
  for (const rule of agentPolicy().dangerPatterns) {
    try {
      if (new RegExp(rule.pattern, "i").test(text)) reasons.push(rule.reason);
    } catch {
      // A malformed pattern must never block work silently.
    }
  }
  return { blocked: reasons.length > 0, reasons: [...new Set(reasons)] };
}
