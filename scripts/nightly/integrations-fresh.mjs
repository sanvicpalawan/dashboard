/**
 * Nightly integration freshness check — read-only monitoring. Reports, per
 * enabled integration: last success age, last sync result, error, and credential
 * presence (hint only, never the credential). Never mutates integrations.
 *
 * Staleness rule: fetched_or_synced within 24h = fresh, otherwise stale.
 * A credential stored with an unknown format is reported, not decrypted.
 */

import { connectDatabase, recordCheck, emitSummary } from "./common.mjs";

function ageHours(date) {
  if (!date) return null;
  return Math.round((Date.now() - new Date(date).getTime()) / 3_600_000);
}

async function main() {
  const client = await connectDatabase();
  await client.connect();
  try {
    const { rows } = await client.query(
      `select i.id, i.key, i.name, i.status, i.enabled,
              i.last_sync_at, i.last_success_at, i.last_error, i.last_checked_at,
              (i.credential_encrypted is not null and i.credential_encrypted like 'v1.1%') as credential_format_v1,
              (i.credential_encrypted is not null) as has_credential,
              (select count(*)::int from sync_runs r
                where r.integration_id = i.id and r.started_at > now() - interval '24 hours') as runs_24h,
              (select r.status from sync_runs r
                where r.integration_id = i.id order by r.started_at desc limit 1) as last_run_status,
              (select r.error from sync_runs r
                where r.integration_id = i.id order by r.started_at desc limit 1) as last_run_error
         from integrations i
        order by i.key`,
    );
    const items = rows.map((row) => {
      const successAge = ageHours(row.last_success_at || row.last_sync_at);
      return {
        key: row.key,
        enabled: row.enabled,
        status: row.status,
        fresh: successAge !== null && successAge <= 24,
        success_age_hours: successAge,
        runs_24h: row.runs_24h,
        last_run_status: row.last_run_status || null,
        error: row.last_error || row.last_run_error || null,
        has_credential: row.has_credential,
      };
    });
    const enabled = items.filter((item) => item.enabled);
    const stale = enabled.filter((item) => (!item.fresh && item.success_age_hours !== null) || item.error);
    const statuses = stale.length ? "stale" : items.some((item) => item.enabled && item.success_age_hours === null) ? "unknown" : "ok";
    const summary = {
      integrations: items.length,
      enabled: enabled.length,
      stale: stale.map((item) => item.key),
      items,
    };
    await recordCheck(client, "integrations.freshness", statuses, summary);
    emitSummary(summary);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
