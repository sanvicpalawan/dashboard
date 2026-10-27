#!/usr/bin/env node
/**
 * Sets a workspace account's email and password, and the session lifetime, from inside
 * the container (the only place with DATABASE_URL).
 *
 *   node scripts/set-user-password.mjs --find old@example.com --email new@example.com \
 *        --password '<new password>' --session-hours 168
 *
 * Every flag except --find is optional. The password is never printed back.
 * Hashing matches src/lib/security.ts exactly: scrypt:<salt hex>:<key hex>.
 */
import { randomBytes, scryptSync } from "node:crypto";
import pg from "pg";

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

const find = (flag("find") || "").trim().toLowerCase();
const email = (flag("email") || "").trim().toLowerCase();
const password = flag("password");
const sessionHours = Number(flag("session-hours") || 0);

if (!find && !email) {
  console.error("Usage: set-user-password.mjs [--find <current email>] [--email <new email>] [--password <new password>] [--session-hours <1-168>]");
  process.exit(1);
}

const hashPassword = (value) => {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${scryptSync(value, salt, 64).toString("hex")}`;
};

const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const client = new pg.Client({ connectionString });

/**
 * Finds the account to update without assuming a single spelling. An account already using the
 * target address wins; otherwise the current address, otherwise the only super administrator.
 */
async function resolveAccount() {
  if (email) {
    const byTarget = await client.query("select id, email, name, workspace_id from users where lower(email) = $1 limit 1", [email]);
    if (byTarget.rows[0]) return { account: byTarget.rows[0], rename: false, via: "target address" };
  }
  if (find) {
    const byFind = await client.query("select id, email, name, workspace_id from users where lower(email) = $1 limit 1", [find]);
    if (byFind.rows[0]) return { account: byFind.rows[0], rename: Boolean(email), via: "current address" };
  }
  const superAdmin = await client.query(
    `select u.id, u.email, u.name, u.workspace_id
       from users u join roles r on r.id = u.role_id
      where r.slug = 'super-admin' and u.status = 'active'
      order by u.last_login_at nulls last, u.created_at
      limit 1`,
  );
  if (superAdmin.rows[0]) return { account: superAdmin.rows[0], rename: Boolean(email), via: "sole super-admin" };
  return null;
}

try {
  await client.connect();

  const resolved = await resolveAccount();
  if (!resolved) throw new Error(`no account matched ${find || email}`);
  const { account, rename, via } = resolved;

  const updates = [];
  const values = [];
  if (email && rename) {
    updates.push(`email = $${values.push(email)}`);
  }
  if (password) {
    updates.push(`password_hash = $${values.push(hashPassword(password))}`, "must_change_password = false");
  }
  updates.push("status = 'active'", "updated_at = now()");

  await client.query(
    `update users set ${updates.join(", ")} where id = $${values.push(account.id)}`,
    values,
  );

  if (sessionHours > 0) {
    const hours = Math.min(168, Math.max(1, sessionHours));
    await client.query(
      `insert into app_settings (key, value, updated_at)
       values ($1, jsonb_build_object('sessionHours', $2::int), now())
       on conflict (key) do update
         set value = app_settings.value || jsonb_build_object('sessionHours', $2::int),
             updated_at = now()`,
      [`workspace:${account.workspace_id}`, hours],
    );
    console.log(`session lifetime set to ${hours}h`);
  }

  const after = await client.query("select email, name, must_change_password from users where id = $1", [account.id]);
  const row = after.rows[0];
  console.log(`account ${account.email} -> ${row.email} (${row.name}) via ${via}${rename ? ", renamed" : ""}`);
  console.log(`password updated: ${password ? "yes" : "no"}`);
  console.log(`must change password: ${row.must_change_password}`);
} catch (error) {
  console.error("UPDATE FAILED:", error.message);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
