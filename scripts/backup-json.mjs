// Logical backup and restore for the Command Center database.
//   node scripts/backup-json.mjs <output.json>     dump every public table
//   node scripts/backup-json.mjs --restore <file>  truncate and reload (refuses without --force)
// Uses DATABASE_URL / DATABASE_URL_UNPOOLED from .env.local. Never commit the output file.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const line of readFileSync(resolve(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
}

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not configured.");

const [first, second, third] = process.argv.slice(2);
const restore = first === "--restore";
const target = restore ? second : first;
if (!target) throw new Error("Usage: backup-json.mjs <output.json> | --restore <file> [--force]");

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

const tables = (await client.query(`select tablename from pg_tables where schemaname = 'public' order by tablename`)).rows.map((row) => row.tablename);

if (restore) {
  if (third !== "--force") throw new Error("Restore truncates every table. Re-run with --force to confirm.");
  const dump = JSON.parse(readFileSync(target, "utf8"));
  // Insert parents before children: PostgreSQL foreign keys are not deferrable by default.
  const edges = (await client.query(`
    select c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f' and n.nspname = 'public'
  `)).rows.filter((row) => row.child !== row.parent);
  const order = [];
  const remaining = new Set(dump.tables);
  while (remaining.size) {
    const ready = [...remaining].filter((table) => !edges.some((edge) => edge.child === table && remaining.has(edge.parent)));
    if (!ready.length) {
      // Circular dependency: break it by taking the next table alphabetically.
      ready.push([...remaining].sort()[0]);
    }
    for (const table of ready) { order.push(table); remaining.delete(table); }
  }
  await client.query("begin");
  try {
    const columnTypes = new Map();
    for (const row of (await client.query(`select table_name, column_name, data_type from information_schema.columns where table_schema = 'public'`)).rows) {
      columnTypes.set(`${row.table_name}.${row.column_name}`, row.data_type);
    }
    const encode = (table, column, value) => {
      const type = columnTypes.get(`${table}.${column}`);
      // node-postgres turns JS arrays into Postgres arrays, which is wrong for json/jsonb columns.
      if ((type === "json" || type === "jsonb") && value !== null && typeof value === "object") return JSON.stringify(value);
      return value;
    };
    await client.query(`truncate ${dump.tables.map((name) => `"${name}"`).join(", ")} cascade`);
    for (const table of order) {
      const rows = dump.data[table] ?? [];
      for (const row of rows) {
        const columns = Object.keys(row);
        await client.query(`insert into "${table}" (${columns.map((c) => `"${c}"`).join(", ")}) values (${columns.map((_, i) => `$${i + 1}`).join(", ")})`, columns.map((c) => encode(table, c, row[c])));
      }
    }
    await client.query("commit");
    console.log(`Restored ${dump.tables.length} tables from ${target}.`);
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
} else {
  const data = {};
  for (const table of tables) data[table] = (await client.query(`select * from "${table}"`)).rows;
  const dump = { createdAt: new Date().toISOString(), source: "palawan-command-center", tables, data };
  mkdirSync(dirname(resolve(target)), { recursive: true });
  writeFileSync(target, JSON.stringify(dump, null, 2));
  console.log(`Dumped ${tables.length} tables to ${target}:`);
  for (const table of tables) console.log(`  ${table}: ${data[table].length} rows`);
}

await client.end();
