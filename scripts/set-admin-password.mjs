// Sets the password for an existing workspace account (real-use bootstrap and rotation).
//   node scripts/set-admin-password.mjs --email you@example.com --out C:\path\outside\repo\admin-password.txt
// The generated password is never printed. It is written only to --out, which must live outside the repository.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { hashPassword } from "../src/lib/security.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const line of readFileSync(resolve(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
}

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

const email = (flag("email") || "").trim().toLowerCase();
const out = flag("out");
if (!email || !out) throw new Error("Usage: set-admin-password.mjs --email <address> --out <file outside the repo>");

const repoRoot = resolve(root);
if (resolve(out).toLowerCase().startsWith(repoRoot.toLowerCase())) throw new Error("--out must be outside the repository.");

const password = randomBytes(24).toString("base64url");
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not configured.");

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const result = await client.query(
    `update users set password_hash = $1, must_change_password = true, status = 'active', updated_at = now()
     where lower(email) = lower($2) returning id, email, name`,
    [hashPassword(password), email],
  );
  if (!result.rowCount) throw new Error(`No account exists for ${email}. Create it in Admin → Users first, or run bootstrap with BOOTSTRAP_ADMIN_PASSWORD.`);
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(resolve(out), `${password}\n`, "utf8");
  console.log(`Password rotated for ${result.rows[0].email} (${result.rows[0].name}).`);
  console.log(`Password written to ${resolve(out)} — move it into your password manager and delete the file.`);
} finally {
  await client.end();
}
