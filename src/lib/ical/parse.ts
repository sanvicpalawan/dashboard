/**
 * A small iCalendar (RFC 5545) reader, scoped to one job: reading availability.
 *
 * Every booking channel a small resort uses — Airbnb, Booking.com, Agoda, most
 * property managers — will export its calendar as an .ics URL. The owner can
 * copy that link out of their own account in about thirty seconds and has no
 * reason to refuse. That is the whole trick behind this connector: no partner
 * agreement, no certification, no API key.
 *
 * What a feed gives us is a list of events. Each event is a block of dates that
 * are already taken. A date is free when no feed says otherwise.
 *
 * Deliberately not implemented: RRULE expansion. Exports from booking channels
 * contain plain events; recurring calendars (holidays, maintenance) do not.
 * A recurring event is flagged so callers can see it rather than silently
 * mishandle it.
 */

export type IcalEvent = {
  uid: string;
  summary: string;
  status: string;
  /** First night taken, as YYYY-MM-DD. */
  start: string;
  /** First night free again, as YYYY-MM-DD. DTEND is exclusive per RFC 5545. */
  end: string;
  allDay: boolean;
  recurring: boolean;
};

type Property = { name: string; params: string[]; value: string };

/** RFC 5545 folds long lines at 75 octets; a continuation starts with a space or tab. */
export function unfold(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
}

function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

/**
 * "20261105" and "20261105T140000Z" both become "2026-11-05". Times are dropped
 * on purpose: a booking covers whole nights, and a resort's timezone is a detail
 * that would otherwise shift dates by a day for no benefit.
 */
function toIsoDate(value: string): string | null {
  const match = value.trim().match(/^(\d{4})(\d{2})(\d{2})/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function splitProperty(line: string): Property | null {
  const colon = line.indexOf(":");
  if (colon < 1) return null;
  const [rawName, ...params] = line.slice(0, colon).split(";");
  const name = rawName.trim().toUpperCase();
  if (!/^[A-Z0-9-]+$/.test(name)) return null;
  return { name, params, value: line.slice(colon + 1) };
}

/** True when the property declares VALUE=DATE, i.e. a whole-day event. */
function isAllDay(property: Property): boolean {
  if (property.params.some((param) => param.toUpperCase() === "VALUE=DATE")) return true;
  return !/T\d/.test(property.value);
}

export function parseIcs(text: string): IcalEvent[] {
  const events: IcalEvent[] = [];
  let current: Record<string, Property> | null = null;
  let recurring = false;

  for (const line of unfold(text).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.toUpperCase() === "BEGIN:VEVENT") {
      current = {};
      recurring = false;
      continue;
    }

    if (trimmed.toUpperCase() === "END:VEVENT") {
      if (current) {
        const start = current.DTSTART ? toIsoDate(current.DTSTART.value) : null;
        const end = current.DTEND ? toIsoDate(current.DTEND.value) : null;
        const status = (current.STATUS?.value || "CONFIRMED").toUpperCase();
        // A cancelled booking is not an occupied night — a channel that keeps the
        // event but flags it CANCELLED must not block the room.
        if (start && status !== "CANCELLED") {
          events.push({
            uid: current.UID?.value || `${start}-${current.SUMMARY?.value || ""}`,
            summary: unescapeText(current.SUMMARY?.value || "").trim(),
            status,
            start,
            end: end && end > start ? end : addDays(start, 1),
            allDay: current.DTSTART ? isAllDay(current.DTSTART) : true,
            recurring,
          });
        }
      }
      current = null;
      continue;
    }

    if (!current) continue;
    const property = splitProperty(trimmed);
    if (!property) continue;
    if (property.name === "RRULE") recurring = true;
    current[property.name] = property;
  }

  return events;
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const stamp = Date.UTC(year, month - 1, day) + days * 86_400_000;
  const next = new Date(stamp);
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

export function todayUtc(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
}
