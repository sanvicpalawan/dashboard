import { test } from "node:test";
import assert from "node:assert/strict";

import { addDays, parseIcs, unfold } from "../src/lib/ical/parse.ts";
import { buildAvailability, occupiedNights, summarise } from "../src/lib/ical/availability.ts";
import { fetchIcs } from "../src/lib/ical/fetch.ts";

const feed = (events: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\n${events}END:VCALENDAR\r\n`;

const allDay = (uid: string, start: string, end: string, summary = "Reserved") =>
  `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART;VALUE=DATE:${start}\r\nDTEND;VALUE=DATE:${end}\r\nSUMMARY:${summary}\r\nEND:VEVENT\r\n`;

// A real export folds long lines at 75 octets. The continuation begins with a space.
test("a folded line is rejoined before parsing", () => {
  const folded = "SUMMARY:Deluxe Sea View\r\n  Suite with Breakfast";
  assert.equal(unfold(folded), "SUMMARY:Deluxe Sea View Suite with Breakfast");
});

test("whole-day events become nights, with the end date exclusive", () => {
  const [event] = parseIcs(feed(allDay("a", "20261112", "20261115")));
  assert.equal(event.start, "2026-11-12");
  assert.equal(event.end, "2026-11-15");
  assert.equal(event.allDay, true);
  assert.deepEqual(occupiedNights(event, "2026-11-01", "2026-12-01"), ["2026-11-12", "2026-11-13", "2026-11-14"]);
});

test("timed events keep their calendar date and drop the clock", () => {
  const [event] = parseIcs(
    feed("BEGIN:VEVENT\r\nUID:b\r\nDTSTART:20261120T140000Z\r\nDTEND:20261122T100000Z\r\nSUMMARY:Booking\r\nEND:VEVENT\r\n"),
  );
  assert.equal(event.start, "2026-11-20");
  assert.equal(event.end, "2026-11-22");
  assert.equal(event.allDay, false);
});

test("a cancelled booking does not block the room", () => {
  const events = parseIcs(
    feed(
      "BEGIN:VEVENT\r\nUID:c\r\nDTSTART;VALUE=DATE:20261101\r\nDTEND;VALUE=DATE:20261103\r\nSTATUS:CANCELLED\r\nEND:VEVENT\r\n" +
        allDay("d", "20261105", "20261106"),
    ),
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].uid, "d");
});

test("an event with no end date takes one night", () => {
  const [event] = parseIcs(feed("BEGIN:VEVENT\r\nUID:e\r\nDTSTART;VALUE=DATE:20261110\r\nEND:VEVENT\r\n"));
  assert.equal(event.start, "2026-11-10");
  assert.equal(event.end, "2026-11-11");
});

test("two channels that never talk still produce one calendar", () => {
  const airbnb = parseIcs(feed(allDay("a1", "20261112", "20261114")));
  const booking = parseIcs(feed(allDay("b1", "20261120", "20261123")));
  const nights = buildAvailability(
    [
      { name: "airbnb", events: airbnb },
      { name: "booking", events: booking },
    ],
    "2026-11-10",
    "2026-11-25",
  );

  assert.equal(nights.length, 15);
  // 15 nights in the window, 5 taken: two by Airbnb, three by Booking.com.
  assert.equal(nights.filter((night) => night.available).length, 10);
  assert.deepEqual(nights.find((night) => night.date === "2026-11-13")?.blockedBy, ["airbnb"]);
  assert.deepEqual(nights.find((night) => night.date === "2026-11-22")?.blockedBy, ["booking"]);
  assert.equal(nights.find((night) => night.date === "2026-11-15")?.available, true);
});

test("a night sold twice is reported as a conflict, not hidden", () => {
  const airbnb = parseIcs(feed(allDay("x1", "20261112", "20261115")));
  const booking = parseIcs(feed(allDay("y1", "20261113", "20261116")));
  const nights = buildAvailability(
    [
      { name: "airbnb", events: airbnb },
      { name: "booking", events: booking },
    ],
    "2026-11-12",
    "2026-11-16",
  );

  const conflict = nights.find((night) => night.date === "2026-11-13");
  assert.deepEqual(conflict?.blockedBy.sort(), ["airbnb", "booking"]);
  assert.equal(summarise(nights, []).conflicts, 2);
});

test("only nights inside the requested window are counted", () => {
  const event = parseIcs(feed(allDay("z", "20261001", "20261231")))[0];
  assert.deepEqual(occupiedNights(event, "2026-11-01", "2026-11-04"), ["2026-11-01", "2026-11-02", "2026-11-03"]);
});

test("dates roll across months and years", () => {
  assert.equal(addDays("2026-11-30", 1), "2026-12-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
});

test("the feed fetcher refuses anything that is not https", async () => {
  const result = await fetchIcs("plain", "http://example.com/calendar.ics");
  assert.equal(result.ics, null);
  assert.match(result.error ?? "", /https/);
});

test("the feed fetcher refuses this machine's own network", async () => {
  for (const target of ["https://localhost/x.ics", "https://127.0.0.1/x.ics", "https://169.254.169.254/latest/meta-data"]) {
    const result = await fetchIcs("local", target);
    assert.equal(result.ics, null, target);
  }
});
