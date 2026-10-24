import { buildAvailability, summarise } from "../src/lib/ical/availability.ts";
import { recommend } from "../src/lib/ical/insights.ts";
import { fetchIcs } from "../src/lib/ical/fetch.ts";
import { parseIcs, todayUtc } from "../src/lib/ical/parse.ts";

/**
 * Point this at any calendar export and see what the OS makes of it.
 *
 *   node scripts/ical-probe.mts https://example.com/calendar.ics [more feeds...]
 */

const candidates = process.argv.slice(2);
const results = await Promise.all(candidates.map((url, index) => fetchIcs(`feed${index + 1}`, url)));

for (const result of results) {
  if (!result.ics) {
    console.log(`${result.name.padEnd(8)} FAILED   ${result.url}  -> ${result.error}`);
    continue;
  }
  const events = parseIcs(result.ics);
  console.log(`${result.name.padEnd(8)} OK       ${result.url}  -> ${events.length} events, first ${events[0]?.start ?? "none"} "${events[0]?.summary ?? ""}"`);
}

const working = results.filter((result) => result.ics);
if (!working.length) process.exit(1);

const feeds = working.map((result) => ({ name: result.name, events: parseIcs(result.ics!) }));
const from = todayUtc();
const [year, month, day] = from.split("-").map(Number);
const stamp = new Date(Date.UTC(year, month - 1, day) + 30 * 86_400_000);
const to = `${stamp.getUTCFullYear()}-${String(stamp.getUTCMonth() + 1).padStart(2, "0")}-${String(stamp.getUTCDate()).padStart(2, "0")}`;
const nights = buildAvailability(feeds, from, to);

console.log("");
console.log(JSON.stringify(summarise(nights, feeds), null, 2));

console.log("");
console.log("what the calendar means:");
for (const item of recommend(nights, 30)) {
  console.log(`${item.kind.padEnd(10)} ${item.from}..${item.to}  ${item.reason}`);
  console.log(`${"".padEnd(10)} -> ${item.action}`);
}

console.log("");
console.log("first 14 nights:");
for (const night of nights.slice(0, 14)) {
  console.log(`${night.date}  ${night.available ? "free " : "taken"} ${night.blockedBy.join(",")} ${night.summaries.join(" / ").slice(0, 50)}`);
}
