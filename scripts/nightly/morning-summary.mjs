/**
 * Nightly morning summary — one system_checks row ("summary.daily") the overview
 * System status card reads. Aggregates the other nightly checks plus DB counts.
 *
 * Honesty rule: if any expected check row is missing or older than 26 hours, the
 * summary's status is "warn" (a broken worker must not look healthy).
 */

import { connectDatabase, recordCheck, emitSummary } from "./common.mjs";

const EXPECTED_CHECKS = [
  { id: "websites.sweep", maxHours: 26 },
  { id: "integrations.freshness", maxHours: 26 },
  { id: "backups.audit", maxHours: 26 },
  { id: "leads.verify", maxHours: 26 },
  { id: "host", maxHours: 2 },
];

function ageHours(date) {
  if (!date) return null;
  return Math.round((Date.now() - new Date(date).getTime()) / 3_600_000);
}

async function main() {
  const client = await connectDatabase();
  await client.connect();
  try {
    const { rows: checks } = await client.query(
      "select id, status, checked_at from system_checks",
    );
    const checkMap = new Map(checks.map((row) => [row.id, row]));
    const staleChecks = EXPECTED_CHECKS
      .filter((expected) => {
        const row = checkMap.get(expected.id);
        const age = ageHours(row?.checked_at);
        return !row || age === null || age > expected.maxHours;
      })
      .map((expected) => expected.id);
    const warningChecks = checks
      .filter((row) => ["warn", "stale"].includes(row.status))
      .map((row) => row.id);

    const [siteCounts, prospectCounts, jobCounts] = await Promise.all([
      client.query(
        `select count(*)::int as total,
                count(*) filter (where status = 'operational')::int as operational,
                count(*) filter (where status in ('degraded', 'offline'))::int as broken,
                count(*) filter (where last_checked_at is null or last_checked_at < now() - interval '26 hours')::int as stale
           from websites`,
      ),
      client.query(
        `select count(*)::int as total,
                count(*) filter (where verification = 'unverified')::int as unverified
           from prospects`,
      ),
      client.query(
        `select count(*)::int as total,
                count(*) filter (where status = 'succeeded')::int as succeeded,
                count(*) filter (where status = 'failed')::int as failed,
                count(*) filter (where status = 'awaiting_approval')::int as awaiting,
                count(*) filter (where status in ('queued', 'running'))::int as pending
           from agent_jobs where created_at > now() - interval '24 hours'`,
      ),
    ]);

    const summary = {
      generatedAt: new Date().toISOString(),
      websites: siteCounts.rows[0],
      prospects: prospectCounts.rows[0],
      jobs24h: jobCounts.rows[0],
      checkStatuses: Object.fromEntries(
        checks.map((row) => [row.id, { status: row.status, ageHours: ageHours(row.checked_at) }]),
      ),
      warnings: {
        staleChecks,
        warningChecks,
      },
    };
    const status = staleChecks.length || warningChecks.length ? "warn" : "ok";
    await recordCheck(client, "summary.daily", status, summary);
    emitSummary(summary);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
