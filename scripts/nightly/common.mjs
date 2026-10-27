/**
 * Shared helpers for deterministic nightly scripts.
 *
 * These run inside the agent-worker container (agent: "script" jobs). They use
 * only the environment the worker already has: DATABASE_URL(_UNPOOLED) and
 * CREDENTIAL_ENCRYPTION_KEY. No LLM, no model credits, no model-generated facts:
 * every value written here comes from a direct check that either answered or did not.
 */

import pg from "pg";
import { createHash, createDecipheriv } from "node:crypto";

export function connectDatabase() {
  const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set in the worker environment.");
  const ssl =
    connectionString.includes("neon.tech") || /sslmode=require/.test(connectionString)
      ? { rejectUnauthorized: false }
      : undefined;
  return new pg.Client({ connectionString, ssl });
}

/** Mirrors src/lib/security.ts decryptSecret exactly (v1.<iv>.<tag>.<payload>, AES-256-GCM). */
export function decryptSecret(value) {
  if (!value) throw new Error("No stored credential.");
  const parts = String(value).split(".");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("Unsupported credential format.");
  const source = process.env.CREDENTIAL_ENCRYPTION_KEY || process.env.AUTH_SECRET;
  if (!source) throw new Error("CREDENTIAL_ENCRYPTION_KEY is required to decrypt stored credentials.");
  const key = createHash("sha256").update(source).digest();
  const iv = Buffer.from(parts[1], "base64url");
  const tag = Buffer.from(parts[2], "base64url");
  const payload = Buffer.from(parts[3], "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(payload), decipher.final()]).toString("utf8");
}

/**
 * Records a check result for the System status card (table created additively,
 * see system_checks DDL in the audit notes). `payload` must be JSON-serialisable
 * and must contain only verified facts — this is the monitoring evidence.
 */
export async function recordCheck(client, id, status, payload) {
  await client.query(
    `insert into system_checks (id, payload, status, checked_at)
     values ($1, $2::jsonb, $3, now())
     on conflict (id) do update
       set payload = excluded.payload, status = excluded.status, checked_at = now()`,
    [id, JSON.stringify(payload), status],
  );
}

/** Reads one system_checks row; null when it has never been written. */
export async function readCheck(client, id) {
  const { rows } = await client.query(
    "select id, payload, status, checked_at from system_checks where id = $1 limit 1",
    [id],
  );
  return rows[0] || null;
}

/** Last line printed becomes the job `result` in the dashboard queue UI. */
export function emitSummary(summary) {
  console.log(JSON.stringify(summary));
}
