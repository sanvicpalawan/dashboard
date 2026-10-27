/**
 * Nightly backup audit — merges the host-cron's facts into one status:
 *
 *   1. system_checks "backups.coolify"   — Coolify's own scheduled backup for
 *      dashboard-postgres (read from the Coolify DB by the host cron; the
 *      Coolify HTTP API does not expose backup schedules).
 *   2. system_checks "backups.host-cron" — daily pg_dump.gz files the host cron
 *      writes for the databases Coolify does not schedule: invoiceshelf,
 *      agents, susibooks (logical db "dubbl"), coolify-db.
 *
 * Freshness rule: latest successful backup <= 26 hours is healthy.
 */

import { connectDatabase, recordCheck, emitSummary, readCheck } from "./common.mjs";

const FRESH_HOURS = 26;

function ageHours(date) {
  if (!date) return null;
  return Math.round((Date.now() - new Date(date).getTime()) / 3_600_000);
}

async function main() {
  const client = await connectDatabase();
  await client.connect();
  try {
    const coolifyRow = await readCheck(client, "backups.coolify");
    const hostCronRow = await readCheck(client, "backups.host-cron");
    const hostFiles = Array.isArray(hostCronRow?.payload?.files) ? hostCronRow.payload.files : [];

    const merged = [];
    // dashboard-postgres: Coolify-scheduled, "merqato" logical DB.
    const coolify = coolifyRow?.payload || null;
    merged.push({
      database: "merqato",
      coveredBy: coolify?.lastExecutionAt ? "coolify-scheduled" : "missing",
      lastBackupAt: coolify?.lastExecutionAt ?? null,
      ageHours: ageHours(coolify?.lastExecutionAt),
      status: coolify?.lastExecutionAt ? (ageHours(coolify.lastExecutionAt) <= FRESH_HOURS ? "ok" : "stale") : "missing",
      checkedAt: coolifyRow?.checked_at ?? null,
    });
    // host-cron DBs, from actual file listings.
    for (const name of ["coolify-db", "invoiceshelf", "agents", "susibooks"]) {
      const files = hostFiles
        .filter((file) => String(file.database || "").toLowerCase() === name)
        .sort((a, b) => (a.takenAt || "") > (b.takenAt || "") ? -1 : 1);
      const latest = files[0] || null;
      merged.push({
        database: name,
        coveredBy: latest ? "host-cron" : "missing",
        lastBackupAt: latest?.takenAt ?? null,
        ageHours: ageHours(latest?.takenAt || null),
        sizeKb: latest?.sizeKb ?? null,
        status: latest ? (ageHours(latest.takenAt) <= FRESH_HOURS ? "ok" : "stale") : "missing",
        checkedAt: hostCronRow?.checked_at ?? null,
      });
    }

    const problems = merged
      .filter((row) => row.status !== "ok")
      .map((row) => `${row.database}: ${row.status}${row.ageHours !== null ? ` (age ${row.ageHours}h)` : ""}`);
    const cronBroken = ageHours(hostCronRow?.checked_at) === null || ageHours(hostCronRow?.checked_at) > FRESH_HOURS;
    if (cronBroken) problems.push(`host cron itself has not reported for >${FRESH_HOURS}h — no checker is running`);
    const summary = {
      databases: merged,
      problems,
      hostCronCheckedAt: hostCronRow?.checked_at ?? null,
      coolifyCheckedAt: coolifyRow?.checked_at ?? null,
    };
    await recordCheck(client, "backups.audit", problems.length ? "warn" : "ok", summary);
    emitSummary(summary);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
