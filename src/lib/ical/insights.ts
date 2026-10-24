import { addDays } from "./parse.ts";
import type { Night } from "./availability.ts";

/**
 * What the calendar means, once it has been read.
 *
 * The feeds only tell us which nights are taken. Every decision a resort actually
 * needs is a step further: which holes will never sell, where the room is being
 * sold twice, whether the next month is too empty or too cheap.
 *
 * These are rules, not predictions. A small model does not get to invent a price;
 * it gets to explain one of these findings to the owner in his own language.
 */

export type Gap = {
  start: string;
  end: string;
  nights: number;
  /** True when the gap is closed on both sides by a booking — these are the ones that never sell. */
  bounded: boolean;
};

export type Recommendation = {
  kind: "conflict" | "fill-gap" | "too-empty" | "raise-rate";
  from: string;
  to: string;
  nights: number;
  reason: string;
  action: string;
};

export function findGaps(nights: Night[]): Gap[] {
  const gaps: Gap[] = [];
  let run: Night[] = [];

  const flush = () => {
    if (!run.length) return;
    const first = run[0].date;
    const startIndex = nights.indexOf(run[0]);
    const endIndex = startIndex + run.length;
    gaps.push({
      start: first,
      end: addDays(run[run.length - 1].date, 1),
      nights: run.length,
      bounded: startIndex > 0 && endIndex < nights.length,
    });
    run = [];
  };

  for (const night of nights) {
    if (night.available) run.push(night);
    else flush();
  }
  flush();
  return gaps;
}

function group(nights: Night[]): { from: string; to: string; count: number }[] {
  const groups: { from: string; to: string; count: number }[] = [];
  for (const night of nights) {
    const last = groups[groups.length - 1];
    if (last && last.to === night.date) {
      last.to = addDays(night.date, 1);
      last.count += 1;
    } else {
      groups.push({ from: night.date, to: addDays(night.date, 1), count: 1 });
    }
  }
  return groups;
}

export function recommend(nights: Night[], horizonDays = 30): Recommendation[] {
  if (!nights.length) return [];
  const horizon = nights.slice(0, Math.min(horizonDays, nights.length));
  const out: Recommendation[] = [];

  // Sold twice. Nothing else on this list matters until this is fixed: the guest
  // who arrives to an occupied room costs the room, the refund and the review.
  for (const block of group(nights.filter((night) => night.blockedBy.length > 1))) {
    out.push({
      kind: "conflict",
      from: block.from,
      to: block.to,
      nights: block.count,
      reason: `Two channels both claim ${block.count === 1 ? "this night" : "these nights"}.`,
      action: "Close the extra channel tonight and message the second guest before they travel.",
    });
  }

  // A one or two night hole between bookings almost never sells on its own: the
  // minimum stay rules on every channel filter it out. These are the cheapest
  // nights to turn into money.
  for (const gap of findGaps(nights).filter((gap) => gap.bounded && gap.nights <= 2)) {
    out.push({
      kind: "fill-gap",
      from: gap.start,
      to: gap.end,
      nights: gap.nights,
      reason: `${gap.nights} night${gap.nights === 1 ? "" : "s"} stranded between two bookings.`,
      action: "Lift the minimum stay for these dates only, or offer them to the waitlist at the weekday rate.",
    });
  }

  const taken = horizon.filter((night) => !night.available).length;
  const occupancy = Math.round((taken / horizon.length) * 100);

  if (occupancy < 35) {
    out.push({
      kind: "too-empty",
      from: horizon[0].date,
      to: addDays(horizon[horizon.length - 1].date, 1),
      nights: horizon.length,
      reason: `Only ${occupancy}% of the next ${horizon.length} nights are booked.`,
      action: "The problem is visibility before price: check the listing answers a phone search, then push the direct booking link.",
    });
  }

  if (occupancy > 85) {
    out.push({
      kind: "raise-rate",
      from: horizon[0].date,
      to: addDays(horizon[horizon.length - 1].date, 1),
      nights: horizon.length,
      reason: `${occupancy}% booked with ${horizon.length - taken} nights left.`,
      action: "Raise the nightly rate on the remaining dates before the next booking arrives.",
    });
  }

  return out;
}

export type InsightSummary = {
  occupied: number;
  free: number;
  occupancy: number;
  gaps: number;
  strandedNights: number;
  conflicts: number;
  recommendations: number;
};

export function insightSummary(nights: Night[], horizonDays = 30): InsightSummary {
  const horizon = nights.slice(0, Math.min(horizonDays, nights.length));
  const occupied = horizon.filter((night) => !night.available).length;
  const gaps = findGaps(nights);
  return {
    occupied,
    free: horizon.length - occupied,
    occupancy: horizon.length ? Math.round((occupied / horizon.length) * 100) : 0,
    gaps: gaps.length,
    strandedNights: gaps.filter((gap) => gap.bounded).reduce((total, gap) => total + gap.nights, 0),
    conflicts: nights.filter((night) => night.blockedBy.length > 1).length,
    recommendations: recommend(nights, horizonDays).length,
  };
}
