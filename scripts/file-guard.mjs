/**
 * File safety guard for the agent worker.
 *
 * Why this exists: a small local model (qwen2.5-coder:3b) answered a job with a
 * whole-file `write` that replaced a 154-line module with a single comment line.
 * The edit was syntactically valid and the job would have been reported as a
 * success, so the damage would only surface later.
 *
 * The check deliberately uses several signals, never file size alone:
 *
 *   1. how much of the original content disappeared (bytes and lines)
 *   2. whether the surviving file lost the structure the original had
 *      (imports, exports, declarations)
 *   3. whether the agent actually issued a whole-file write for that path
 *   4. whether the job instructions asked for a destructive change
 *   5. whether a tracked file vanished entirely
 *
 * A file is restored from the job's baseline commit only when the evidence
 * agrees. A legitimate large edit (a rewrite the instructions asked for, or a
 * file that keeps its structure) is left alone.
 *
 * Everything is relative to git, so the guard never invents its own copy of the
 * workspace: the baseline commit is the source of truth.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const STRUCTURE = /^\s*(import\s|export\s|function\s|class\s|interface\s|type\s|const\s|async\s+function\s)/gm;
const DESTRUCTIVE_INTENT = /(delete|remove|drop|replace\s+(the\s+)?(whole\s+|entire\s+)?file|rewrite|from scratch|truncate|empty\s+(the\s+)?file|start\s+over)/i;

/** Thresholds, kept in one place so a reviewer can see exactly how strict this is. */
export const LIMITS = {
  /** Forget about tiny files: a 6-line config legitimately becomes 3 lines. */
  minLinesToGuard: 20,
  /** Fraction of the original content that must disappear before this is suspicious. */
  shrinkRatio: 0.6,
  /** The survivor must also keep less than this fraction of the original structure. */
  keepStructure: 0.25,
};

function git(dir, args, options = {}) {
  return execFileSync("git", ["-C", dir, ...args], {
    encoding: options.buffer ? "buffer" : "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  });
}

function isGitRepo(dir) {
  try {
    git(dir, ["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

/** Records the commit a job starts from. Returns null when the directory is not a repo. */
export function captureBaseline(dir) {
  if (!dir || !existsSync(dir) || !isGitRepo(dir)) return null;
  try {
    return { commit: git(dir, ["rev-parse", "HEAD"]).trim(), directory: dir };
  } catch {
    return null;
  }
}

function countStructure(text) {
  const matches = String(text || "").match(STRUCTURE);
  return matches ? matches.length : 0;
}

function countLines(buffer) {
  if (!buffer || buffer.length === 0) return 0;
  const text = buffer.toString("utf8");
  const lines = text.split("\n");
  return text.endsWith("\n") ? lines.length - 1 : lines.length;
}

/** Parses `git diff --numstat` against the baseline: added/deleted lines per path. */
function changedPaths(dir, commit) {
  let raw = "";
  try {
    raw = git(dir, ["diff", "--numstat", "--no-renames", commit, "--"]);
  } catch {
    return [];
  }
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [added, deleted, ...rest] = line.split("\t");
      return { path: rest.join("\t"), added: Number(added) || 0, deleted: Number(deleted) || 0 };
    })
    .filter((entry) => entry.path);
}

function originalFile(dir, commit, file) {
  try {
    return git(dir, ["show", `${commit}:${file}`], { buffer: true });
  } catch {
    return null;
  }
}

/**
 * Looks for edits that destroyed a file.
 *
 * @param {string} dir            job directory
 * @param {{commit: string}} baseline  value from captureBaseline()
 * @param {object} opts
 * @param {Set<string>} opts.writeTargets  paths the agent wrote whole-file
 * @param {string} opts.instructions       the job text, used only for intent
 * @returns {{ path: string, reason: string, restored: boolean }[]}
 */
export function inspectChanges(dir, baseline, opts = {}) {
  if (!baseline || !baseline.commit || !dir) return [];
  const writeTargets = opts.writeTargets instanceof Set ? opts.writeTargets : new Set(opts.writeTargets || []);
  const instructions = String(opts.instructions || "");
  const destructiveIntent = DESTRUCTIVE_INTENT.test(instructions);

  const findings = [];
  for (const change of changedPaths(dir, baseline.commit)) {
    const file = change.path;
    const absolute = path.join(dir, file);
    const before = originalFile(dir, baseline.commit, file);
    if (before === null) continue; // a new file cannot lose content it never had

    const beforeLines = countLines(before);
    const exists = existsSync(absolute);
    const after = exists ? readFileSync(absolute) : Buffer.alloc(0);
    const afterLines = countLines(after);

    // 1. A tracked file that disappeared.
    if (!exists) {
      if (destructiveIntent) continue;
      findings.push({ path: file, reason: "the job deleted a tracked file and the instructions did not ask for a deletion", restored: false });
      continue;
    }

    // 2. Smaller files are allowed to change shape; the guard is for real modules.
    if (beforeLines < LIMITS.minLinesToGuard) continue;

    const shrink = beforeLines > 0 ? 1 - afterLines / beforeLines : 0;
    if (shrink < LIMITS.shrinkRatio) continue;

    // 3. Content shrank a lot. Structure is the decisive signal: a legitimate
    //    rewrite keeps its declarations. A file that lost them needs a second
    //    corroborating signal before it is treated as damaged.
    const beforeStructure = countStructure(before.toString("utf8"));
    const afterStructure = countStructure(after.toString("utf8"));
    const structureLost = beforeStructure > 0 && afterStructure < Math.max(1, beforeStructure * LIMITS.keepStructure);
    const usedWholeFileWrite = writeTargets.has(file) || writeTargets.has(absolute);
    const nearEmpty = afterLines < 5;
    const almostEverything = shrink >= 0.9;

    if (destructiveIntent) continue; // the job asked for this
    if (!structureLost) continue; // the file still looks like itself
    if (!usedWholeFileWrite && !nearEmpty && !almostEverything) continue;

    const signals = [
      `${beforeLines} → ${afterLines} lines (-${Math.round(shrink * 100)}%)`,
      usedWholeFileWrite ? "replaced by a whole-file write" : null,
      structureLost ? `declarations ${beforeStructure} → ${afterStructure}` : null,
    ].filter(Boolean);

    findings.push({ path: file, reason: signals.join("; "), restored: false });
  }

  return findings;
}

/** Restores the flagged paths from the baseline commit. */
export function restoreFiles(dir, files, baseline) {
  if (!dir || !baseline || !baseline.commit || !files.length) return [];
  const restored = [];
  for (const file of files) {
    try {
      git(dir, ["checkout", baseline.commit, "--", file]);
      restored.push(file);
    } catch {
      // Report the failure through the return value rather than throwing mid-job.
    }
  }
  return restored;
}

/**
 * Convenience wrapper used by the worker: inspect, restore, and describe.
 * Returns null when nothing looks wrong.
 */
export function enforceFileSafety(dir, baseline, opts) {
  const findings = inspectChanges(dir, baseline, opts);
  if (!findings.length) return null;
  const restored = restoreFiles(dir, findings.map((finding) => finding.path), baseline);
  for (const finding of findings) finding.restored = restored.includes(finding.path);
  const summary = findings
    .map((finding) => `${finding.path}: ${finding.reason}${finding.restored ? " (restored)" : " (could not restore)"}`)
    .join(" | ");
  return { findings, summary };
}
