import { addDays, type IcalEvent } from "./parse.ts";

export type Feed = { name: string; events: IcalEvent[] };

export type Night = {
  date: string;
  available: boolean;
  /** Which feed blocked the night. Empty when available. */
  blockedBy: string[];
  summaries: string[];
};

/**
 * A feed's event occupies every night from `start` up to but not including `end`.
 * A booking arriving on the 12th and leaving on the 15th takes nights 12, 13, 14.
 */
export function occupiedNights(event: IcalEvent, from: string, to: string): string[] {
  const nights: string[] = [];
  let cursor = event.start > from ? event.start : from;
  while (cursor < event.end && cursor < to) {
    nights.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return nights;
}

/**
 * Merges any number of feeds. The room is unavailable when *any* feed says so —
 * that is the entire point of the connector: channels never talk to each other,
 * but they all tell us, and we hold the union.
 */
export function buildAvailability(feeds: Feed[], from: string, to: string): Night[] {
  const map = new Map<string, Night>();
  let cursor = from;
  while (cursor < to) {
    map.set(cursor, { date: cursor, available: true, blockedBy: [], summaries: [] });
    cursor = addDays(cursor, 1);
  }

  for (const feed of feeds) {
    for (const event of feed.events) {
      for (const night of occupiedNights(event, from, to)) {
        const entry = map.get(night);
        if (!entry) continue;
        entry.available = false;
        if (!entry.blockedBy.includes(feed.name)) entry.blockedBy.push(feed.name);
        if (event.summary && !entry.summaries.includes(event.summary)) entry.summaries.push(event.summary);
      }
    }
  }

  return [...map.values()];
}

export type AvailabilitySummary = {
  from: string;
  to: string;
  nights: number;
  available: number;
  occupancy: number;
  /** Nights where two channels both claim the room. This is a double booking, and it is the exact failure the connector exists to catch. */
  conflicts: number;
  perFeed: { name: string; events: number; nights: number; error?: string }[];
};

export function summarise(nights: Night[], feeds: Feed[]): AvailabilitySummary {
  const available = nights.filter((night) => night.available).length;
  return {
    from: nights[0]?.date ?? "",
    to: nights.length ? addDays(nights[nights.length - 1].date, 1) : "",
    nights: nights.length,
    available,
    occupancy: nights.length ? Math.round(((nights.length - available) / nights.length) * 1000) / 10 : 0,
    conflicts: nights.filter((night) => night.blockedBy.length > 1).length,
    perFeed: feeds.map((feed) => ({
      name: feed.name,
      events: feed.events.length,
      nights: new Set(feed.events.flatMap((event) => occupiedNights(event, feed.events[0]?.start ?? "0000-01-01", "9999-12-31"))).size,
    })),
  };
}
