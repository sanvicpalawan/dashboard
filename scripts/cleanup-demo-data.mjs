// Removes the fictional records created by src/db/bootstrap.ts seedDemo/seedExpenses/seedProspects/seedTools.
//   node scripts/cleanup-demo-data.mjs           dry run: lists exactly what would be deleted
//   node scripts/cleanup-demo-data.mjs --apply   deletes those rows in one transaction
// Every predicate is tied to a value hard-coded in the seed functions, so real records are never matched.
// Take a backup first: node scripts/backup-json.mjs <file outside the repo>
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const line of readFileSync(resolve(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
}

const apply = process.argv.includes("--apply");

const SEED_CLIENTS = ["Nacpan Beach Resort", "Tala Studio Palawan", "Balay Coffee Roasters", "Isla Expeditions", "Luntian Builders", "Coral Logic Advisory", "Sirena Dive Club"];
const SEED_PROJECT_CODES = ["NBR-26", "TLA-14", "BCR-09", "ISL-31", "LNT-07", "CLA-03"];
const SEED_PROSPECTS = ["Kalui Seafood Kitchen", "Daluyon Island Hopping", "Puerto Dental Studio", "Mangrove Eco Lodge", "Coron Motor Rentals", "Baragatan Crafts Collective", "Taytay Fresh Market Delivery", "Sunset Yoga Shala", "Palawan Pearl Traders", "Isla Verde Dive Resort"];
const SEED_SERVICES = ["Distinct Website Design & Development", "Operational Web Application", "Applied AI Agent", "Business Automation Sprint", "Social Media Management", "Managed Hosting & Maintenance", "White-label Software Partnership", "Recurring Product Support"];
const SEED_TOOL_SLUGS = ["guest-brief-dispatcher", "wholesale-inquiry-router", "resort-booking-agent", "uptime-ssl-sentinel", "social-content-scheduler", "invoice-reminder-bot"];
const SEED_NOTIFICATIONS = ["Two invoices need attention", "Isla launch deadline approaching", "Integration setup incomplete", "Local demo workspace ready"];

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not configured.");

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

const ids = async (sql, params = []) => (await client.query(sql, params)).rows.map((row) => row.id);

async function plan() {
  const demoUsers = await ids(`select id from users where email like '%@demo.merqato.local'`);
  const demoClients = await ids(`select id from clients where email like '%.example' and name = any($1)`, [SEED_CLIENTS]);
  const demoProjects = await ids(`select id from projects where code = any($1) and (repository_url is null or repository_url like 'https://github.com/merqato/%')`, [SEED_PROJECT_CODES]);
  const demoProspects = await ids(`select id from prospects where email like '%.example' and business_name = any($1)`, [SEED_PROSPECTS]);
  const demoTools = await ids(`select id from tools where slug = any($1)`, [SEED_TOOL_SLUGS]);
  return { demoUsers, demoClients, demoProjects, demoProspects, demoTools };
}

const { demoUsers, demoClients, demoProjects, demoProspects, demoTools } = await plan();

const steps = [
  ["invoices (source = demo)", `delete from invoices where source = 'demo' and total_minor >= 0`],
  ["subscriptions of seeded clients", `delete from subscriptions where client_id = any($1)`, [demoClients]],
  ["project comments of seeded projects", `delete from project_comments where project_id = any($1)`, [demoProjects]],
  ["project links of seeded projects", `delete from project_links where project_id = any($1)`, [demoProjects]],
  ["project media of seeded projects", `delete from project_media where project_id = any($1)`, [demoProjects]],
  ["tasks of seeded projects", `delete from tasks where project_id = any($1)`, [demoProjects]],
  ["incidents seeded with demo notices", `delete from incidents where description like 'Demo %'`],
  ["websites on .example domains", `delete from websites where domain like '%.example'`],
  ["expenses marked 'Demo expense record'", `delete from expenses where notes = 'Demo expense record'`],
  ["automation runs with demo external ids", `delete from automation_runs where external_id like 'demo-%'`],
  ["background jobs flagged demo", `delete from background_jobs where payload->>'demo' = 'true'`],
  ["notifications seeded with demo copy", `delete from notifications where title = any($1)`, [SEED_NOTIFICATIONS]],
  ["seeded projects", `delete from projects where id = any($1)`, [demoProjects]],
  ["seeded clients", `delete from clients where id = any($1)`, [demoClients]],
  ["seeded prospects and their activities", `delete from prospects where id = any($1)`, [demoProspects]],
  ["seeded tool pages", `delete from tools where id = any($1)`, [demoTools]],
  ["seeded services (invented pricing)", `delete from services where name = any($1)`, [SEED_SERVICES]],
  ["fictional demo team members", `delete from users where id = any($1)`, [demoUsers]],
];

console.log(apply ? "APPLYING demo-data cleanup" : "DRY RUN — nothing is deleted without --apply");
const previews = {
  "seeded clients": ["select name from clients where id = any($1)", demoClients],
  "seeded prospects and their activities": ["select business_name from prospects where id = any($1)", demoProspects],
  "seeded projects": ["select code || ' ' || name from projects where id = any($1)", demoProjects],
  "fictional demo team members": ["select email from users where id = any($1)", demoUsers],
};

await client.query("begin");
try {
  let total = 0;
  for (const [label, sql, params] of steps) {
    const preview = previews[label];
    if (preview) {
      const rows = (await client.query(preview[0], [preview[1]])).rows.map((row) => Object.values(row)[0]);
      if (rows.length) console.log(`  ${label}: ${rows.join(", ")}`);
    }
    const result = await client.query(sql, params ?? []);
    total += result.rowCount ?? 0;
    console.log(`  ${label}: ${result.rowCount ?? 0}`);
  }
  if (apply) {
    const workspace = await client.query(`update workspaces set demo_mode = false, updated_at = now() where demo_mode = true returning slug`);
    console.log(`  workspace demo_mode set to false: ${workspace.rowCount} workspace(s)`);
    await client.query("commit");
    console.log(`Deleted ${total} seeded rows.`);
  } else {
    await client.query("rollback");
    console.log(`Would delete ${total} seeded rows. Re-run with --apply to commit.`);
  }
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  await client.end();
}
