/**
 * Nightly website sweep — mirrors src/app/api/websites/check/route.ts exactly:
 * HEAD request (redirect: manual, 10s timeout) for reachability/degraded/offline,
 * plus TLS certificate expiry read for https URLs. Updates the websites table
 * (status, last_checked_at, ssl_expiry) and writes a system_checks row.
 */

import { connectDatabase, recordCheck, emitSummary } from "./common.mjs";

import tls from "node:tls";

const TIMEOUT_MS = 10_000;
const UA = "MerQato-Uptime-Check/1.0";

function certificateExpiry(url) {
  if (url.protocol !== "https:") return Promise.resolve(null);
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host: url.hostname, port: Number(url.port || 443), servername: url.hostname, rejectUnauthorized: true, timeout: 8_000 },
      () => {
        const certificate = socket.getPeerCertificate();
        const expiry = certificate?.valid_to ? new Date(certificate.valid_to) : null;
        socket.end();
        resolve(expiry && !Number.isNaN(expiry.getTime()) ? expiry.toISOString().slice(0, 10) : null);
      },
    );
    socket.once("error", () => resolve(null));
    socket.once("timeout", () => { socket.destroy(); resolve(null); });
  });
}

function sslAmountOfDaysLeft(dateString) {
  if (!dateString) return null;
  const then = new Date(`${dateString}T00:00:00Z`).getTime();
  if (Number.isNaN(then)) return null;
  return Math.round((then - Date.now()) / 86_400_000);
}

async function checkWebsite(website) {
  const started = Date.now();
  let status = "offline";
  let httpStatus = null;
  let detail = "";
  const url = new URL(website.production_url);
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
      headers: { "User-Agent": UA },
    });
    httpStatus = response.status;
    status = response.status < 400 ? "operational" : response.status < 500 ? "degraded" : "offline";
    detail = `HTTP ${response.status} in ${Date.now() - started} ms`;
  } catch (error) {
    detail = error instanceof Error ? error.message.slice(0, 300) : "Network request failed.";
  }
  const sslExpiry = await certificateExpiry(url);
  return { website, status, httpStatus, detail, sslExpiry };
}

async function main() {
  const client = await connectDatabase();
  await client.connect();
  try {
    const { rows } = await client.query(
      "select id, name, domain, production_url, status, ssl_expiry from websites order by domain",
    );
    const results = [];
    for (const website of rows) {
      const result = await checkWebsite(website);
      await client.query(
        `update websites
            set status = $2,
                last_checked_at = now(),
                ssl_expiry = coalesce($3::text::date, ssl_expiry),
                updated_at = now()
          where id = $1`,
        [website.id, result.status, result.sslExpiry],
      );
      results.push({
        domain: website.domain,
        status: result.status,
        httpStatus: result.httpStatus,
        ssl_expiry: result.sslExpiry,
        ssl_days_left: sslAmountOfDaysLeft(result.sslExpiry),
        detail: result.detail,
      });
    }
    const operational = results.filter((r) => r.status === "operational").length;
    const degraded = results.filter((r) => r.status === "degraded").length;
    const offline = results.filter((r) => r.status === "offline").length;
    const sslWarning = results.filter((r) => r.ssl_days_left !== null && r.ssl_days_left <= 21);
    const summary = { checked: results.length, operational, degraded, offline, sslWarning: sslWarning.map((r) => r.domain), results };
    await recordCheck(client, "websites.sweep", offline || degraded > 0 ? "warn" : "ok", summary);
    emitSummary(summary);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
