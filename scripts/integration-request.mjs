#!/usr/bin/env node
/**
 * Bridge between OpenCode and the credentials the Command Center already holds.
 *
 * The dashboard stores provider credentials encrypted in Postgres. This script
 * lets the agent make a read call through a stored credential without the token
 * ever appearing in a prompt, a log or a shell argument.
 *
 * Usage:
 *   node scripts/integration-request.mjs <provider> <path> [flags]
 *
 * Flags:
 *   --method GET|POST|PATCH|DELETE   default GET
 *   --body <json>                    request body for POST/PATCH
 *   --account <id|label>             pick a specific GitHub account
 *   --all-accounts                   repeat the call for every stored account
 *   --raw                            print the body only, no status envelope
 *
 * Examples:
 *   node scripts/integration-request.mjs coolify /applications
 *   node scripts/integration-request.mjs github /repos/sanvicpalawan/sanvicph
 *   node scripts/integration-request.mjs cloudflare /zones
 *
 * The credential is never printed. Only the provider response is.
 */

import { createDecipheriv, createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import pg from "pg";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
loadEnv({ path: path.join(repoRoot, ".env.local"), quiet: true });

const DATABASE_URL = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local.");
  process.exit(1);
}

function encryptionKey() {
  const source = process.env.CREDENTIAL_ENCRYPTION_KEY || process.env.AUTH_SECRET;
  if (!source) throw new Error("CREDENTIAL_ENCRYPTION_KEY is missing from .env.local.");
  return createHash("sha256").update(source).digest();
}

function decryptSecret(value) {
  const [version, iv, tag, payload] = value.split(".");
  if (version !== "v1" || !iv || !tag || !payload) throw new Error("Stored credential format is invalid. Reconnect the integration.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(payload, "base64url")), decipher.final()]).toString("utf8");
}

const PROVIDERS = {
  github: { base: "https://api.github.com", auth: "bearer", headers: { "X-GitHub-Api-Version": "2022-11-28", Accept: "application/vnd.github+json" } },
  vercel: { base: "https://api.vercel.com", auth: "bearer" },
  cloudflare: { base: "https://api.cloudflare.com/client/v4", auth: "bearer" },
  openrouter: { base: "https://openrouter.ai/api/v1", auth: "bearer" },
  coolify: { auth: "bearer", suffix: "/api/v1", requiresBase: true },
  invoiceshelf: { auth: "bearer", suffix: "/api/v1", requiresBase: true },
  ollama: { auth: "optional-bearer", requiresBase: true },
  upcloud: { base: "https://api.upcloud.com/1.3", auth: "basic" },
  opencode: { auth: "basic", requiresBase: true },
};

function parseArgs(argv) {
  const positional = [];
  const flags = { method: "GET", body: null, account: null, allAccounts: false, raw: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--method") flags.method = String(argv[++index] || "GET").toUpperCase();
    else if (arg === "--body") flags.body = argv[++index];
    else if (arg === "--account") flags.account = argv[++index];
    else if (arg === "--all-accounts") flags.allAccounts = true;
    else if (arg === "--raw") flags.raw = true;
    else positional.push(arg);
  }
  return { positional, flags };
}

function accounts(record, only) {
  if (!record.credential_encrypted) return [];
  let map;
  try {
    const parsed = JSON.parse(decryptSecret(record.credential_encrypted));
    map = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { default: parsed };
  } catch {
    map = { default: decryptSecret(record.credential_encrypted) };
  }
  const meta = Array.isArray(record.config?.accounts) ? record.config.accounts : [];
  const list = Object.entries(map)
    .filter(([, token]) => typeof token === "string" && token.length > 0)
    .map(([id, token]) => ({ id, token, label: meta.find((entry) => entry.id === id)?.label || id }));
  if (!only) return list;
  return list.filter((entry) => entry.id === only || entry.label === only);
}

async function call(provider, record, account, target, flags) {
  const definition = PROVIDERS[provider];
  const base = resolveBase(definition, record);
  const url = new URL(base.replace(/\/+$/, "") + "/" + target.replace(/^\/+/, ""));
  const headers = { Accept: "application/json", "User-Agent": "palawan-command-center-agent/1.0", ...(definition.headers || {}) };
  if (definition.auth === "bearer") headers.Authorization = `Bearer ${account.token}`;
  else if (definition.auth === "optional-bearer") headers.Authorization = `Bearer ${account.token}`;
  else if (definition.auth === "basic") headers.Authorization = `Basic ${Buffer.from(account.token).toString("base64")}`;
  if (flags.body) headers["Content-Type"] = "application/json";

  const started = Date.now();
  const response = await fetch(url, { method: flags.method, headers, body: flags.body || undefined });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { provider, account: account.label, url: url.toString(), status: response.status, ok: response.ok, ms: Date.now() - started, body };
}

function resolveBase(definition, record) {
  if (!definition.requiresBase && definition.base) return definition.base;
  if (!record.base_url) throw new Error(`${record.key} needs an instance URL configured in Admin -> Integrations.`);
  return record.base_url.replace(/\/+$/, "") + (definition.suffix || "");
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const [provider, target = "/"] = positional;
if (!provider || !PROVIDERS[provider]) {
  console.error(`Supported providers: ${Object.keys(PROVIDERS).join(", ")}`);
  process.exit(1);
}

const client = new pg.Client({ connectionString: DATABASE_URL, ssl: DATABASE_URL.includes("neon.tech") ? { rejectUnauthorized: false } : undefined });
await client.connect();
const { rows } = await client.query("select key, config, base_url, credential_encrypted, enabled, status from integrations where key = $1", [provider]);
await client.end();

const record = rows[0];
if (!record) {
  console.error(`No ${provider} integration row exists in the workspace.`);
  process.exit(1);
}
if (!record.enabled) {
  console.error(`${provider} is disabled in the Command Center. Enable it before the agent uses it.`);
  process.exit(1);
}

const list = accounts(record, flags.account);
if (!list.length) {
  console.error(`No credential is stored for ${provider}. Connect it in Admin -> Integrations first.`);
  process.exit(1);
}

const results = [];
for (const account of flags.allAccounts ? list : list.slice(0, 1)) {
  try {
    results.push(await call(provider, record, account, target, flags));
  } catch (error) {
    results.push({ provider, account: account.label, error: error.message });
  }
}

if (flags.raw && results.length === 1 && "body" in results[0]) {
  console.log(typeof results[0].body === "string" ? results[0].body : JSON.stringify(results[0].body, null, 2));
} else {
  console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
}

process.exit(results.every((result) => result.ok) ? 0 : 1);
