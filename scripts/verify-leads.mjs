#!/usr/bin/env node
/**
 * Lead verification.
 *
 * Turns imported directory rows into evidence-backed records. Nothing here is
 * inferred: every verdict comes from a check that either answered or did not.
 *
 *   email domain  -> DNS MX record exists (the domain accepts mail at all)
 *   website       -> HTTP response, and whether the business name appears in the title
 *   social/booking-> HTTP response only; these sites block bots, so a block is
 *                    recorded as "blocked", never counted as evidence either way
 *   phone         -> Philippine mobile/landline shape
 *
 * Verdicts
 *   verified  the business name appears in a fetched page title, or MX + valid phone + a live page
 *   partial   at least one independent check passed
 *   unverified nothing could be confirmed
 *
 * Usage: node scripts/verify-leads.mjs [--limit 20] [--apply] [--json]
 * Without --apply it prints what it would write and changes nothing.
 */

import pg from "pg";

const args = process.argv.slice(2);
const limit = Number((args.find((a) => a.startsWith("--limit=")) || "--limit=10").split("=")[1]) || 10;
const apply = args.includes("--apply");
const asJson = args.includes("--json");

const UA = "PalawanCollective-LeadCheck/1.0 (+https://command.merqato.digital)";
const TIMEOUT = 8000;

const normalise = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const squash = (value) => normalise(value).replace(/\s+/g, "");

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
    const { resolveMx } = await import("node:dns/promises");
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
  await sleep(600);
  const booking = await httpCheck(prospect.social_links?.match(/https?:\/\/[^\s,]*booking\.com[^\s,]*/i)?.[0]);
  await sleep(600);
  const social = await httpCheck(prospect.social_links?.match(/https?:\/\/(www\.)?(facebook|instagram)\.com[^\s,]*/i)?.[0]);
  await sleep(300);
  const mx = await mxCheck(prospect.email);
  const phoneOk = phoneLooksPhilippine(prospect.phone || prospect.whatsapp);

  if (site) evidence.push(site.error ? `website: ${site.error}` : `website: HTTP ${site.status}${site.title ? ` — "${site.title.slice(0, 80)}"` : ""}`);
  if (booking) evidence.push(booking.error ? `booking: ${booking.error}` : `booking: HTTP ${booking.status}${booking.blocked ? " (blocked)" : ""}${booking.title ? ` — "${booking.title.slice(0, 60)}"` : ""}`);
  if (social) evidence.push(social.error ? `social: ${social.error}` : `social: HTTP ${social.status}${social.blocked ? " (blocked)" : ""}`);
  if (mx) evidence.push(mx.hasMx ? `email domain ${mx.domain}: MX ok` : `email domain ${mx.domain}: no MX`);
  if (phoneOk !== null) evidence.push(`phone: ${phoneOk ? "valid PH shape" : "not a PH number shape"}`);

  const titleMatches =
    (site?.title && squash(site.title).includes(name)) ||
    (booking?.title && squash(booking.title).includes(name)) ||
    (social?.title && squash(social.title).includes(name));

  const livePage = Boolean((site && site.status >= 200 && site.status < 400) || (booking && booking.status >= 200 && booking.status < 400));

  let verdict = "unverified";
  if (titleMatches) verdict = "verified";
  else if (mx?.hasMx && phoneOk && livePage) verdict = "verified";
  else if (mx?.hasMx || livePage || phoneOk) verdict = "partial";

  return { verdict, evidence };
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const client = new pg.Client({ connectionString, ssl: false });
  await client.connect();
  try {
    const { rows } = await client.query(
      `select id, business_name, email, phone, whatsapp, website, social_links, verification, notes
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
      if (apply) {
        await client.query(
          `update prospects
              set verification = $2,
                  notes = case when position($3 in notes) > 0 then notes else trim(both E'\n' from notes || E'\n' || $3) end,
                  updated_at = now()
            where id = $1`,
          [prospect.id, verdict, note],
        );
      }
    }
    if (asJson) console.log(JSON.stringify(results, null, 2));
    else {
      for (const result of results) {
        console.log(`${result.verdict.padEnd(10)} ${result.business.slice(0, 40).padEnd(42)} ${result.evidence.join(" · ").slice(0, 120)}`);
      }
      const counts = results.reduce((acc, r) => ({ ...acc, [r.verdict]: (acc[r.verdict] || 0) + 1 }), {});
      console.log(`\n${rows.length} checked — ${JSON.stringify(counts)}${apply ? " (written)" : " (dry run, nothing written)"}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
