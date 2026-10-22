// Imports the El Nido resort directory into the Leads pipeline.
//   node scripts/import-prospects.mjs --file <csv>            dry run: mapping preview + duplicate report, writes nothing
//   node scripts/import-prospects.mjs --file <csv> --apply     inserts the rows that are safe to create
// Create-only: existing prospects are never modified or merged. Duplicates are skipped, near-matches are flagged for review.
// The CSV holds personal contact data: keep it and the report outside the repository.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const line of readFileSync(resolve(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
}

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const apply = args.includes("--apply");
const file = flag("file", "");
const sourceLabel = flag("source", "El Nido resort directory (CSV)");
const reportPath = flag("report", resolve(root, "..", "merqato", "backups", `prospects-import-${new Date().toISOString().slice(0, 10)}.json`));
if (!file) throw new Error("Usage: import-prospects.mjs --file <csv> [--apply] [--source <label>] [--report <path>]");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (char !== "\r") field += char;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((item) => item.some((cell) => cell.trim() !== ""));
}

const clean = (value) => (value ?? "").replace(/\s+/g, " ").trim();
const digits = (value) => {
  const only = (value ?? "").replace(/[^\d]/g, "");
  return only.length >= 10 ? only.slice(-10) : only.length >= 7 ? only : "";
};
const nameKey = (value) => (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const industryFor = (category) => {
  const value = category.toLowerCase();
  if (value.includes("tour")) return "Tour operator";
  if (value.includes("government")) return "Government";
  // Luxury / Upscale / Boutique / Mid-Range / Budget / Glamping all describe resort accommodation tiers.
  return "Hospitality - resort";
};
const locationFor = (city) => {
  const value = clean(city);
  if (!value) return "";
  return /palawan/i.test(value) ? value : `${value}, Palawan`;
};

const table = parseCsv(readFileSync(resolve(file), "utf8"));
const header = table[0].map((cell) => cell.trim());
const index = (name) => header.findIndex((cell) => cell.toLowerCase() === name.toLowerCase());
const column = {
  city: index("City/Area"),
  name: index("Resort Name"),
  phone: index("Phone / WhatsApp"),
  viber: index("Viber"),
  email: index("Email"),
  address: index("Address"),
  facebook: index("Facebook URL"),
  booking: index("Booking.com URL"),
  category: index("Category"),
};
for (const [key, position] of Object.entries(column)) {
  if (position < 0) throw new Error(`Column not found for "${key}" in ${file}`);
}

const records = table.slice(1).map((row, offset) => {
  const at = (position) => clean(row[position]);
  const phone = at(column.phone);
  const address = at(column.address);
  const booking = at(column.booking);
  const viber = at(column.viber);
  const category = at(column.category);
  const notes = [
    address ? `Address: ${address}` : "",
    booking ? `Booking.com listing: ${booking}` : "",
    viber ? `Viber listed: ${viber}` : "",
    category ? `Directory category: ${category}` : "",
    `Imported from ${sourceLabel}, source row ${offset + 2}. Contact details not yet verified with the business.`,
  ].filter(Boolean).join("\n");
  return {
    row: offset + 2,
    businessName: at(column.name),
    contactName: "",
    email: at(column.email).toLowerCase(),
    phone,
    whatsapp: phone,
    website: "",
    socialLinks: at(column.facebook),
    industry: industryFor(category),
    location: locationFor(at(column.city)),
    source: sourceLabel,
    stage: "new",
    verification: "unverified",
    pitchedServices: [],
    estimatedValueMinor: 0,
    notes,
  };
});

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not configured.");
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

const [workspace] = (await client.query(`select id from workspaces order by created_at limit 1`)).rows;
if (!workspace) throw new Error("No workspace found.");
const [owner] = (await client.query(`select id from users where workspace_id = $1 order by created_at limit 1`, [workspace.id])).rows;

const existing = (await client.query(`select id, business_name, email, phone, whatsapp, location from prospects where workspace_id = $1`, [workspace.id])).rows;
const existingEmails = new Map(existing.filter((row) => row.email).map((row) => [row.email.toLowerCase(), row]));
const existingPhones = new Map();
for (const row of existing) {
  for (const value of [row.phone, row.whatsapp]) {
    const key = digits(value);
    if (key) existingPhones.set(key, row);
  }
}
const existingNames = new Map(existing.map((row) => [`${nameKey(row.business_name)}|${nameKey(row.location)}`, row]));

const seenEmails = new Map();
const seenPhones = new Map();
const seenNames = new Map();
const seenRecords = [];
const results = [];

// Same group, different property: names share a leading brand ("Cauayan ...", "El Nido Resorts (...)").
const words = (value) => (value ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
const sameBrand = (a, b) => {
  const left = words(a);
  const right = words(b);
  let shared = 0;
  while (shared < left.length && shared < right.length && left[shared] === right[shared]) shared += 1;
  if (shared === 0) return false;
  return shared >= 2 || left.slice(0, shared).join("").length >= 6;
};
// A contact desk is not a separate prospect.
const DEPARTMENT = /\b(sales office|front office|front desk|reservations? office|booking office|head office|admin office)\b/i;

for (const record of records) {
  const emailKey = record.email;
  const phoneKey = digits(record.phone);
  const nameKeyValue = `${nameKey(record.businessName)}|${nameKey(record.location)}`;

  const shared = [];
  if (emailKey && existingEmails.has(emailKey)) shared.push(existingEmails.get(emailKey));
  else if (emailKey && seenEmails.has(emailKey)) shared.push(seenEmails.get(emailKey));
  if (phoneKey && existingPhones.has(phoneKey)) shared.push(existingPhones.get(phoneKey));
  else if (phoneKey && seenPhones.has(phoneKey)) shared.push(seenPhones.get(phoneKey));
  const sharedWith = shared.filter((row) => row.businessName !== record.businessName);

  const sameName = existingNames.get(nameKeyValue) ?? seenNames.get(nameKeyValue);
  const known = [...existing.map((row) => ({ businessName: row.business_name })), ...seenRecords];
  const brandMatch = known.find((row) => row.businessName !== record.businessName && sameBrand(record.businessName, row.businessName));
  const contactDesk = brandMatch && (DEPARTMENT.test(record.businessName) || DEPARTMENT.test(brandMatch.businessName));

  let status = "create";
  let reasons = [];
  let flags = [];

  if (!record.businessName || record.businessName.length < 2) {
    status = "skipped";
    reasons = ["missing business name"];
  } else if (sameName) {
    status = "skipped";
    reasons = [`same business name and location already present ("${sameName.businessName}")`];
  } else if (contactDesk) {
    status = "review";
    reasons = [`contact desk of "${brandMatch.businessName}" (brand name match) - not imported as a separate prospect`];
  } else if (sharedWith.length) {
    flags = [`Shares contact details with ${sharedWith.map((row) => `"${row.businessName}"`).join(", ")} - confirm whether this is a separate property or one group booking contact.`];
  }

  if (flags.length) record.notes = `${flags.join("\n")}\n${record.notes}`;
  results.push({ ...record, status, reasons, flags });

  if (emailKey && !seenEmails.has(emailKey)) seenEmails.set(emailKey, record);
  if (phoneKey && !seenPhones.has(phoneKey)) seenPhones.set(phoneKey, record);
  if (!seenNames.has(nameKeyValue)) seenNames.set(nameKeyValue, record);
  seenRecords.push(record);
}

const created = results.filter((item) => item.status === "create");
const skipped = results.filter((item) => item.status === "skipped");
const review = results.filter((item) => item.status === "review");
const flagged = created.filter((item) => item.flags.length);

const masked = (value) => (!value ? "" : value.replace(/[^\s@.]/g, "*"));
console.log(`${apply ? "IMPORT" : "DRY RUN"} | ${records.length} source rows | ${created.length} to create (${flagged.length} flagged) | ${skipped.length} skipped | ${review.length} to review`);
console.log("Field mapping: Resort Name -> business name | Phone / WhatsApp -> phone + WhatsApp | Email -> email | City/Area -> location | Category -> industry (resort tiers become 'Hospitality - resort') | Facebook URL -> social link | Address, Booking.com URL, Viber, category -> notes. No contact person, website, deal value or service is invented.\n");
for (const item of results.slice(0, 12)) {
  console.log(`row ${item.row}: ${item.businessName} | ${item.location} | ${item.industry} | email ${masked(item.email) || "-"} | phone ${masked(item.phone) || "-"} | ${item.status}${item.reasons.length ? ` (${item.reasons.join("; ")})` : ""}${item.flags.length ? " [contact shared]" : ""}`);
}
if (results.length > 12) console.log(`... ${results.length - 12} more rows in the report.`);

let inserted = 0;
if (apply) {
  await client.query("begin");
  try {
    for (const record of created) {
      await client.query(
        `insert into prospects (workspace_id, owner_id, business_name, contact_name, email, phone, whatsapp, website, social_links, industry, location, source, stage, verification, pitched_services, estimated_value_minor, notes)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [workspace.id, owner?.id ?? null, record.businessName, record.contactName, record.email, record.phone, record.whatsapp, record.website, record.socialLinks, record.industry, record.location, record.source, record.stage, record.verification, JSON.stringify([]), 0, record.notes],
      );
      inserted += 1;
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  applied: apply,
  sourceFile: resolve(file),
  sourceLabel,
  counts: { source: records.length, inserted, creatable: created.length, flagged: flagged.length, skipped: skipped.length, review: review.length },
  rows: results.map((item) => ({ row: item.row, businessName: item.businessName, status: item.status, reasons: item.reasons, flags: item.flags })),
};
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`\nReport written to ${reportPath}`);
console.log(apply ? `Inserted ${inserted} prospects.` : "Nothing inserted. Re-run with --apply to import the rows marked create.");

await client.end();
