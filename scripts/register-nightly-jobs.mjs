#!/usr/bin/env node
/**
 * Registers the deterministic nightly jobs in agent_jobs.
 *
 * Runs inside a container (dashboard or worker) because that is the only place with
 * DATABASE_URL. Idempotent: a job whose schedule_key already has a queued or running
 * row is left alone, so re-running this never doubles the schedule.
 *
 * Every job is agent="script": the worker runs scripts/nightly/<name>.mjs as plain
 * Node, with no model and no prompt. The first run is placed at 02:00 Asia/Manila;
 * the worker keeps later runs on that same wall-clock slot.
 */
import pg from "pg";

const NIGHTLY = [
  { name: "integrations-fresh", title: "Nightly integration freshness check" },
  { name: "website-sweep", title: "Nightly website sweep" },
  { name: "leads-verify", title: "Nightly prospect verification" },
  { name: "backups-audit", title: "Nightly backup audit" },
  { name: "morning-summary", title: "Nightly morning summary" },
];

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const NEXT_RUN = `(date_trunc('day', now() at time zone 'Asia/Manila')
  + case when (now() at time zone 'Asia/Manila')::time < time '02:00'
          then interval '2 hours' else interval '26 hours' end) at time zone 'Asia/Manila'`;

const client = new pg.Client({ connectionString });

try {
  await client.connect();

  const workspace = await client.query("select id from workspaces order by created_at limit 1");
  if (!workspace.rows[0]) throw new Error("no workspace row");
  const owner = await client.query("select id, coalesce(nullif(name, ''), email) as label from users order by created_at limit 1");
  if (!owner.rows[0]) throw new Error("no user row");

  const workspaceId = workspace.rows[0].id;
  const createdBy = owner.rows[0].id;
  const createdByName = owner.rows[0].label || "nightly";

  let inserted = 0;
  for (const job of NIGHTLY) {
    const scheduleKey = `nightly:${job.name}`;
    const { rowCount } = await client.query(
      `insert into agent_jobs (
          workspace_id, created_by, created_by_name, title, instructions, directory,
          agent, model, status, approval, max_attempts, repeat_minutes, schedule_key,
          attempts, run_at
       )
       select $1::uuid, $2::uuid, $3::text, $4::text, $5::text, '/workspace',
              'script', null, 'queued', 'auto', 2, 1440, $6::text, 0, ${NEXT_RUN}
       where not exists (
         select 1 from agent_jobs where schedule_key = $6::text and status in ('queued', 'running')
       )`,
      [workspaceId, createdBy, createdByName, job.title, `scripts/nightly/${job.name}.mjs`, scheduleKey],
    );
    inserted += rowCount ?? 0;
    console.log(`${rowCount ? "queued" : "already scheduled"} ${scheduleKey}`);
  }

  const scheduled = await client.query(
    `select schedule_key, status, repeat_minutes,
            to_char(run_at at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI') as next_run_manila
       from agent_jobs
      where schedule_key like 'nightly:%' and status in ('queued', 'running')
      order by schedule_key`,
  );

  for (const row of scheduled.rows) {
    console.log(`${row.schedule_key} ${row.status} every ${row.repeat_minutes}m next ${row.next_run_manila} Asia/Manila`);
  }

  const distinct = new Set(scheduled.rows.map((row) => row.schedule_key)).size;
  console.log(`registered ${inserted} new, ${distinct}/${NIGHTLY.length} nightly jobs scheduled`);
  if (distinct !== NIGHTLY.length) throw new Error(`expected ${NIGHTLY.length} scheduled jobs, found ${distinct}`);
} catch (error) {
  console.error("REGISTER FAILED:", error.message);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
