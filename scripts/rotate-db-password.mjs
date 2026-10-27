#!/usr/bin/env node
/**
 * Rotates the production Postgres password and rewrites DATABASE_URL for the Coolify
 * applications that use it.
 *
 * Why this runs in a container: the database is not publicly reachable and the VPS has
 * no shell we can use, so the only place with both the current credentials and the
 * network path is the running application. A Coolify scheduled task invokes it.
 *
 * Requires (remove both once the rotation is done):
 *   COOLIFY_TOKEN  Coolify API token with write access
 *   COOLIFY_APPS   comma-separated application UUIDs whose env should be updated
 *
 * The new password is generated here and never printed.
 */
import pg from "pg";
import { randomBytes } from "node:crypto";

const API = process.env.COOLIFY_API_URL || "https://studio.merqato.digital/api/v1";
const token = process.env.COOLIFY_TOKEN;
const apps = (process.env.COOLIFY_APPS || "").split(",").map((entry) => entry.trim()).filter(Boolean);
const current = process.env.DATABASE_URL;

if (!token || !apps.length) {
  console.log("rotation skipped: COOLIFY_TOKEN / COOLIFY_APPS are not set");
  process.exit(0);
}
if (!current) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const password = [...randomBytes(40)].map((byte) => ALPHABET[byte % ALPHABET.length]).join("");
const withPassword = (dsn, value) => {
  const url = new URL(dsn);
  url.password = value;
  return url.toString();
};

async function main() {
  const client = new pg.Client({ connectionString: current });
  await client.connect();
  const { rows } = await client.query("select format($q$ALTER USER %I WITH PASSWORD %L$q$, current_user, $1) as stmt", [password]);
  await client.query(rows[0].stmt);
  await client.end();
  console.log("password changed");

  const check = new pg.Client({ connectionString: withPassword(current, password) });
  await check.connect();
  await check.query("select 1 as ok");
  await check.end();
  console.log("new password verified against the database");

  for (const app of apps) {
    for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"]) {
      const base = key === "DATABASE_URL" ? current : process.env.DATABASE_URL_UNPOOLED || current;
      const response = await fetch(`${API}/applications/${app}/envs`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ key, value: withPassword(base, password) }),
      });
      if (!response.ok) throw new Error(`Coolify ${app} ${key} -> HTTP ${response.status}`);
      console.log(`updated ${app} ${key}`);
    }
  }

  console.log("rotation complete; redeploy the listed applications to pick up the new value");
}

main().catch((error) => {
  console.error("ROTATION FAILED:", error.message);
  process.exit(1);
});
