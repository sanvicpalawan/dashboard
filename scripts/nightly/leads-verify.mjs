/**
 * Nightly prospect verification — chunked, evidence-backed adaptation of the
 * recovered scripts/verify-leads.mjs (commit 70eb634, fix 6adf377).
 *
 * Deterministic checks only:
 *   website        -> HTTP status, business name matched against page title
 *   booking/social -> HTTP status (403/429 recorded as "blocked" evidence)
 *   email domain   -> DNS MX
 *   phone          -> Philippine mobile/landline shape
 *
 * Always applies (this is the nightly writer): next 20 unverified prospects by
 * oldest created_at, verdict written with a dated evidence note appended once.
 */

import { connectDatabase, recordCheck, emitSummary } from "./common.mjs";

import { resolveMx } from "node:dns/promises";

const LIMIT = 20;
const TIMEOUT = 12_000;
const UA = "PalawanCollective-LeadVerifier/1.0";

const limit = Math.max(
  1,
  Math.min(50, Number((process.argv.find((a) => a.startsWith("--limit=")) || `--limit=${LIMIT}`).split("=")[1]) || LIMIT),
);

function squash(value) {
  return String(value || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

async function httpCheck(url) {
  if (!url) return null;
  let target = url.trim();
  if (!/^https?:\/\//i.test(target)) target = `https://${target}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const response = await fetch(target, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": UA, accept: "text/html" },
    });
    const type = response.headers.get("content-type") || "";
    let title = "";
    if (type.includes("text/html")) {
      const body = (await response.text()).slice(0, 200_000);
      const match = body.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
      title = match ? match[1].replace(/\s+/g, " ").trim() : "";
    }
    return { status: response.status, title, blocked: response.status === 403 || response.status === 429 };
  } catch (error) {
    return { status: 0, title: "", blocked: false, error: error.name === "AbortError" ? "timeout" : error.message };
  } finally {
    clearTimeout(timer);
  }
}

async function mxCheck(email) {
  const domain = String(email || "").split("@")[1];
  if (!domain) return null;
  try {
    const records = await resolveMx(domain);
    return { domain, hasMx: records.length > 0, hosts: records.length };
  } catch {
    return { domain, hasMx: false, hosts: 0 };
  }
}

function phoneLooksPhilippine(phone) {
  const digits = String(phone || "").replace(/[^\d+]/g, "");
  if (!digits) return null;
  return /^(\+63|63|0)9\d{9}$/.test(digits) || /^(\+63|63|0)[2-8]\d{7,8}$/.test(digits);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function assess(prospect) {
  const evidence = [];
  const name = squash(prospect.business_name);

  const site = await httpCheck(prospect.website);
  await sleep(400);
  const booking = await httpCheck(prospect.social_links?.match(/https?:\/\/[^\s,]*booking\.com[^\s,]*/i)?.[0]);
  await sleep(400);
  const social = await httpCheck(prospect.social_links?.match(/https?:\/\/(www\.)?(facebook|instagram)\.com[^\s,]*/i)?.[0]);
  await sleep(200);
  const mx = await mxCheck(prospect.email);
  const phoneOk = phoneLooksPhilippine(prospect.phone || prospect.whatsapp);

  if (site) evidence.push(site.error ? `website: ${site.error}` : `website: HTTP ${site.status}${site.title ? ` — "${site.title.slice(0, 80)}"` : ""}`);
  if (booking) evidence.push(booking.error ? `booking: ${booking.error}` : `booking: HTTP ${booking.status}${booking.blocked ? " (blocked)" : ""}`);
  if (social) evidence.push(social.error ? `social: ${social.error}` : `social: HTTP ${social.status}${social.blocked ? " (blocked)" : ""}`);
  if (mx) evidence.push(mx.hasMx ? `email domain ${mx.domain}: MX ok` : `email domain ${mx.domain}: no MX`);
  if (phoneOk !== null) evidence.push(`phone: ${phoneOk ? "valid PH shape" : "not a PH number shape"}`);

  const titleMatches =
    (site?.title && squash(site.title).includes(name)) ||
    (booking?.title && squash(booking.title).includes(name)) ||
    (social?.title && squash(social.title).includes(name));

  const livePage = Boolean(
    (site && site.status >= 200 && site.status < 400) ||
    (booking && booking.status >= 200 && booking.status < 400),
  );

  let verdict = "unverified";
  if (titleMatches) verdict = "verified";
  else if (mx?.hasMx && phoneOk && livePage) verdict = "verified";
  else if (mx?.hasMx || livePage || phoneOk) verdict = "partial";

  return { verdict, evidence };
}

async function main() {
  const client = await connectDatabase();
  await client.connect();
  try {
    const { rows } = await client.query(
      `select id, business_name, email, phone, whatsapp, website, social_links, verification
         from prospects
        where verification = 'unverified'
        order by created_at
        limit $1`,
      [limit],
    );
    const results = [];
    for (const prospect of rows) {
      const { verdict, evidence } = await assess(prospect);
      const stamp = new Date().toISOString().slice(0, 10);
      const note = `[check ${stamp}] ${verdict}: ${evidence.join(" · ")}`;
      results.push({ id: prospect.id, business: prospect.business_name, verdict, evidence });
      await client.query(
        `update prospects
            set verification = $2,
                notes = case when position($3 in notes) > 0 then notes else trim(both E'\n' from notes || E'\n' || $3) end,
                updated_at = now()
          where id = $1`,
        [prospect.id, verdict, note],
      );
      await sleep(150);
    }
    const { rows: remaining } = await client.query(
      "select count(*)::int as unverified from prospects where verification = 'unverified'",
    );
    const counts = { verified: 0, partial: 0, unverified: 0 };
    for (const result of results) counts[result.verdict] += 1;
    if (rows.length) {
      for (const result of results) {
        console.log(`${result.verdict.padEnd(10)} ${result.business.slice(0, 40).padEnd(42)} ${result.evidence.join(" · ").slice(0, 120)}`);
      }
    }
    const summary = { checked: rows.length, ...counts, unverifiedRemaining: remaining[0]?.unverified ?? null };
    await recordCheck(client, "leads.verify", summary.verified + summary.partial > 0 ? "ok" : "warn", summary);
    emitSummary(summary);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
