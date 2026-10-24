import { apiUser } from "@/lib/auth";
import { buildAvailability, summarise, type Feed } from "@/lib/ical/availability";
import { fetchFeeds } from "@/lib/ical/fetch";
import { insightSummary, recommend } from "@/lib/ical/insights";
import { parseIcs, todayUtc } from "@/lib/ical/parse";

export const dynamic = "force-dynamic";

/**
 * Availability across any number of channel calendars.
 *
 *   GET /api/availability?feed=https://...&feed=https://...&days=90
 *
 * Each feed is a calendar export copied by the property owner out of Airbnb,
 * Booking.com, Agoda or their property manager. The response says, night by
 * night, whether the room is free and which channel took it.
 */
export async function GET(request: Request) {
  const { response } = await apiUser("websites.view");
  if (response) return response;

  const url = new URL(request.url);
  const urls = url.searchParams.getAll("feed").map((value) => value.trim()).filter(Boolean);
  if (!urls.length) {
    return Response.json({ error: "Add at least one ?feed=https://... calendar url." }, { status: 400 });
  }
  if (urls.length > 8) return Response.json({ error: "Eight feeds at a time, no more." }, { status: 400 });

  const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 90, 1), 365);
  const from = (url.searchParams.get("from") || todayUtc()).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return Response.json({ error: "from must be YYYY-MM-DD." }, { status: 400 });

  const to = (() => {
    const [year, month, day] = from.split("-").map(Number);
    const stamp = new Date(Date.UTC(year, month - 1, day) + days * 86_400_000);
    return `${stamp.getUTCFullYear()}-${String(stamp.getUTCMonth() + 1).padStart(2, "0")}-${String(stamp.getUTCDate()).padStart(2, "0")}`;
  })();

  const fetched = await fetchFeeds(
    urls.map((feedUrl, index) => {
      try {
        return { name: new URL(feedUrl).hostname.replace(/^www\./, ""), url: feedUrl };
      } catch {
        return { name: `feed ${index + 1}`, url: feedUrl };
      }
    }),
  );

  const feeds: Feed[] = [];
  const report = fetched.map((entry) => {
    if (!entry.ics) return { name: entry.name, url: entry.url, events: 0, error: entry.error };
    const events = parseIcs(entry.ics);
    feeds.push({ name: entry.name, events });
    return { name: entry.name, url: entry.url, events: events.length };
  });

  const nights = buildAvailability(feeds, from, to);
  return Response.json({
    summary: summarise(nights, feeds),
    insights: insightSummary(nights, days),
    recommendations: recommend(nights, days),
    feeds: report,
    nights,
  });
}
