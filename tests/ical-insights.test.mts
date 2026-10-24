import { test } from "node:test";
import assert from "node:assert/strict";

import { findGaps, insightSummary, recommend } from "../src/lib/ical/insights.ts";
import type { Night } from "../src/lib/ical/availability.ts";

/** Build a window of nights from a compact string: "tt ff tt" style, t = taken. */
function window(pattern: string, from = "2026-11-01"): Night[] {
  const days = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];
  const base = days.indexOf(from);
  return pattern
    .replace(/\s/g, "")
    .split("")
    .map((flag, index) => ({
      date: days[(base + index) % days.length],
      available: flag !== "t",
      blockedBy: flag === "t" ? ["airbnb"] : [],
      summaries: [],
    }));
}

test("a hole between two bookings is found and marked as stranded", () => {
  const gaps = findGaps(window("tt ff tt"));
  assert.equal(gaps.length, 1);
  assert.deepEqual(gaps[0], { start: "2026-11-03", end: "2026-11-05", nights: 2, bounded: true });
});

test("open space at the edges of the window is not a stranded gap", () => {
  const gaps = findGaps(window("ff tt ff"));
  assert.equal(gaps.length, 2);
  assert.equal(gaps[0].bounded, false);
  assert.equal(gaps[1].bounded, false);
});

test("a two night hole is recommended for filling, a long one is not", () => {
  const short = recommend(window("tt ff tt"), 8);
  assert.ok(short.some((item) => item.kind === "fill-gap"));

  const long = recommend(window("tt ffff t"), 8);
  assert.ok(!long.some((item) => item.kind === "fill-gap"));
});

test("a night sold by two channels outranks everything else", () => {
  const nights = window("tttt");
  nights[1].blockedBy = ["airbnb", "booking"];
  const result = recommend(nights, 4);
  assert.equal(result[0].kind, "conflict");
  assert.equal(result[0].from, "2026-11-02");
});

test("an empty month is called a visibility problem, not a pricing problem", () => {
  const result = recommend(window("f f f f f f f f f f"), 10);
  const empty = result.find((item) => item.kind === "too-empty");
  assert.ok(empty);
  assert.match(empty!.reason, /0%/);
  assert.match(empty!.action, /visibility/);
});

test("a nearly full month is recommended for a rate rise", () => {
  const result = recommend(window("tttttttt f"), 9);
  assert.ok(result.some((item) => item.kind === "raise-rate"));
});

test("the summary counts stranded nights, not just gaps", () => {
  const summary = insightSummary(window("tt ff tt ff"), 10);
  // Two gaps, but only the first is closed on both sides — the tail is open space.
  assert.equal(summary.gaps, 2);
  assert.equal(summary.strandedNights, 2);
  assert.equal(summary.occupied, 4);
  assert.equal(summary.occupancy, 50);
});
