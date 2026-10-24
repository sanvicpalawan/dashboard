#!/usr/bin/env node
/**
 * Tests for scripts/file-guard.mjs.
 *
 * Each case builds a throwaway git repo, makes one edit, and asserts whether the
 * guard flags it. Run with: node scripts/test-file-guard.mjs
 *
 * The cases exist because a 3B model truncated a 154-line module to a single
 * comment and the job was reported as a success. Truncation must fail loudly,
 * and ordinary edits must still pass.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { captureBaseline, enforceFileSafety, inspectChanges } from "./file-guard.mjs";

let failures = 0;

function check(name, condition, detail = "") {
  if (condition) {
    console.log(`ok   ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const MODULE = `import { readFile } from "node:fs/promises";
import path from "node:path";

export type LaunchState = "connected" | "disconnected";

export type LaunchLink = {
  id: string;
  label: string;
  href: string;
};

export type LaunchGroup = {
  title: string;
  links: LaunchLink[];
};

const GROUPS: LaunchGroup[] = [];

export function groupFor(state: LaunchState): LaunchGroup[] {
  return GROUPS.filter((group) => group.links.length > 0);
}

export async function readState(file: string): Promise<LaunchState> {
  const raw = await readFile(path.resolve(file), "utf8");
  return raw.trim() === "connected" ? "connected" : "disconnected";
}

export function summarise(groups: LaunchGroup[]): string {
  return groups.map((group) => group.title).join(", ");
}
`;

const SMALL_CONFIG = `PORT=3000
NODE_ENV=production
`;

function makeRepo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "file-guard-"));
  const run = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  run("init", "-q");
  run("config", "user.email", "test@local");
  run("config", "user.name", "File Guard Test");
  run("config", "core.autocrlf", "false");
  mkdirSync(path.join(dir, "src"), { recursive: true });
  writeFileSync(path.join(dir, "src", "launchpad.ts"), MODULE);
  writeFileSync(path.join(dir, "env.example"), SMALL_CONFIG);
  run("add", ".");
  run("commit", "-qm", "baseline");
  return { dir, run };
}

function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // A locked temp directory on Windows is not a test failure.
  }
}

// ---------------------------------------------------------------------------
// 1. The exact failure that prompted this guard: a whole-file write that leaves
//    a single comment line where a module used to be.
// ---------------------------------------------------------------------------
{
  const { dir } = makeRepo();
  const baseline = captureBaseline(dir);
  const target = path.join(dir, "src", "launchpad.ts");
  writeFileSync(target, "// Local worker runs Qwen 3B; the 7B model is blocked.\n");

  const result = enforceFileSafety(dir, baseline, {
    writeTargets: new Set(["src/launchpad.ts"]),
    instructions: "Add one comment line above the first export in src/lib/launchpad.ts.",
  });

  check("truncating a module is caught", Boolean(result), result ? "" : "guard returned no finding");
  check("truncated file is restored", existsSync(target) && readFileSync(target, "utf8") === MODULE);
  check("finding names the file", Boolean(result && result.findings.some((f) => f.path === "src/launchpad.ts")));

  // A restored tree must be clean, otherwise the damage leaks into a commit.
  const status = execFileSync("git", ["-C", dir, "status", "--porcelain"], { encoding: "utf8" }).trim();
  check("workspace is clean after restore", status === "", status);

  cleanup(dir);
}

// ---------------------------------------------------------------------------
// 2. The legitimate edit the model was asked to make: add one line.
// ---------------------------------------------------------------------------
{
  const { dir } = makeRepo();
  const baseline = captureBaseline(dir);
  const target = path.join(dir, "src", "launchpad.ts");
  const edited = MODULE.replace("export type LaunchState", "// Local worker runs Qwen 3B.\nexport type LaunchState");
  writeFileSync(target, edited);

  const result = enforceFileSafety(dir, baseline, {
    writeTargets: new Set(["src/launchpad.ts"]),
    instructions: "Add one comment line above the first export in src/lib/launchpad.ts.",
  });

  check("an added comment passes", result === null, result ? result.summary : "");
  check("the added comment survives", readFileSync(target, "utf8") === edited);
  cleanup(dir);
}

// ---------------------------------------------------------------------------
// 3. A big but honest rewrite: the file keeps its declarations.
// ---------------------------------------------------------------------------
{
  const { dir } = makeRepo();
  const baseline = captureBaseline(dir);
  const target = path.join(dir, "src", "launchpad.ts");
  writeFileSync(target, `import { db } from "@/db";

export function groups(): string[] {
  return [];
}

export function summarise(): string {
  return groups().join(", ");
}
`);

  const result = enforceFileSafety(dir, baseline, {
    writeTargets: new Set(["src/launchpad.ts"]),
    instructions: "Simplify launchpad.ts.",
  });
  check("a rewrite that keeps its exports passes", result === null, result ? result.summary : "");
  cleanup(dir);
}

// ---------------------------------------------------------------------------
// 4. Size alone must not save a file: no whole-file write was recorded, but the
//    structure disappeared anyway (for example an in-place replace).
// ---------------------------------------------------------------------------
{
  const { dir } = makeRepo();
  const baseline = captureBaseline(dir);
  writeFileSync(path.join(dir, "src", "launchpad.ts"), "// TODO\n// TODO\n// TODO\n");

  const result = enforceFileSafety(dir, baseline, {
    writeTargets: new Set(),
    instructions: "Add one comment line above the first export in src/lib/launchpad.ts.",
  });
  check("structure loss is caught without a write signal", Boolean(result));
  cleanup(dir);
}

// ---------------------------------------------------------------------------
// 5. Intent matters: the job explicitly asked to replace the file's contents.
// ---------------------------------------------------------------------------
{
  const { dir } = makeRepo();
  const baseline = captureBaseline(dir);
  writeFileSync(path.join(dir, "src", "launchpad.ts"), "export const placeholder = true;\n");

  const result = enforceFileSafety(dir, baseline, {
    writeTargets: new Set(["src/launchpad.ts"]),
    instructions: "Replace the whole file src/launchpad.ts with a one-line placeholder.",
  });
  check("a requested replacement is allowed", result === null, result ? result.summary : "");
  cleanup(dir);
}

// ---------------------------------------------------------------------------
// 6. Deleting a tracked file is caught, and can be asked for.
// ---------------------------------------------------------------------------
{
  const { dir } = makeRepo();
  const baseline = captureBaseline(dir);
  rmSync(path.join(dir, "env.example"));

  const accidental = inspectChanges(dir, baseline, { instructions: "Update the launchpad comment." });
  check("an unrequested deletion is caught", accidental.some((f) => f.path === "env.example"));

  const requested = inspectChanges(dir, baseline, { instructions: "Delete env.example, it is unused." });
  check("a requested deletion is allowed", !requested.some((f) => f.path === "env.example"));
  cleanup(dir);
}

// ---------------------------------------------------------------------------
// 7. Small files are not guarded: a 2-line env example becoming 1 line is normal.
// ---------------------------------------------------------------------------
{
  const { dir } = makeRepo();
  const baseline = captureBaseline(dir);
  writeFileSync(path.join(dir, "env.example"), "PORT=3000\n");
  const result = enforceFileSafety(dir, baseline, { instructions: "Trim env.example." });
  check("small config files are left alone", result === null, result ? result.summary : "");
  cleanup(dir);
}

// ---------------------------------------------------------------------------
// 8. No git repository: the guard stays out of the way.
// ---------------------------------------------------------------------------
{
  const dir = mkdtempSync(path.join(os.tmpdir(), "file-guard-bare-"));
  check("non-repo directories are ignored", captureBaseline(dir) === null);
  cleanup(dir);
}

console.log(failures === 0 ? "\nall file guard tests passed" : `\n${failures} file guard test(s) failed`);
process.exit(failures === 0 ? 0 : 1);
