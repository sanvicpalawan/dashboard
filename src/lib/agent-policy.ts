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

export function allowedRoots() {
  const extra = (process.env.AGENT_ALLOWED_ROOTS || "").split(";").map((entry) => entry.trim()).filter(Boolean);
  return [...new Set([...agentPolicy().allowedRoots, ...extra])];
}

/** Normalises a path for prefix comparison (case-insensitive on Windows). */
function normalise(value: string) {
  return path.resolve(value).replace(/[\\/]+$/, "").toLowerCase();
}

export function checkDirectory(directory: string): { ok: boolean; error?: string } {
  const value = (directory || "").trim();
  if (!value) return { ok: false, error: "A working directory is required." };
  if (!path.isAbsolute(value)) return { ok: false, error: "The working directory must be an absolute path." };
  const target = normalise(value);
  const roots = allowedRoots().map(normalise);
  const inside = roots.some((root) => target === root || target.startsWith(`${root}\\`) || target.startsWith(`${root}/`));
  if (!inside) return { ok: false, error: `That directory is outside the agent allowlist (${allowedRoots().join(", ")}). Add it to config/agent-policy.json to permit it.` };
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
