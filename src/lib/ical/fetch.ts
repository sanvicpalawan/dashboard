import { lookup } from "node:dns/promises";

/**
 * Fetches a calendar feed with the guard rails a server needs when the URL comes
 * from a user: this endpoint will happily fetch anything it is told to, including
 * the machine it runs on and the services beside it.
 */

const BLOCKED_HOSTS = new Set(["localhost", "localhost.localdomain", "metadata.google.internal", "instance-data"]);

const PRIVATE_V4 = [/^0\./, /^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./];

function isPrivateAddress(address: string): boolean {
  if (address.includes(":")) {
    const lower = address.toLowerCase();
    return lower === "::1" || lower === "::" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80:");
  }
  return PRIVATE_V4.some((pattern) => pattern.test(address));
}

export type FeedFetch = { name: string; url: string; ics: string | null; error?: string };

export async function fetchIcs(name: string, rawUrl: string, timeoutMs = 8000, maxBytes = 2_000_000): Promise<FeedFetch> {
  const url = rawUrl.trim();
  if (!url) return { name, url, ics: null, error: "empty url" };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { name, url, ics: null, error: "not a valid url" };
  }

  if (parsed.protocol !== "https:") return { name, url, ics: null, error: "only https feeds are fetched" };
  if (BLOCKED_HOSTS.has(parsed.hostname.toLowerCase())) return { name, url, ics: null, error: "host not allowed" };

  // Check every address the name resolves to. A name that resolves to both a
  // public and a private address is rejected rather than guessed at.
  try {
    const addresses = await lookup(parsed.hostname, { all: true, verbatim: true });
    if (!addresses.length) return { name, url, ics: null, error: "host did not resolve" };
    if (addresses.some((entry) => isPrivateAddress(entry.address))) {
      return { name, url, ics: null, error: "host resolves to a private address" };
    }
  } catch {
    return { name, url, ics: null, error: "host did not resolve" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(parsed, {
      signal: controller.signal,
      redirect: "follow",
      headers: { accept: "text/calendar, text/plain;q=0.9, */*;q=0.5", "user-agent": "PalawanCollective-Availability/1.0" },
    });
    if (!response.ok) return { name, url, ics: null, error: `HTTP ${response.status}` };

    const body = await response.text();
    if (body.length > maxBytes) return { name, url, ics: null, error: "feed too large" };
    if (!body.includes("BEGIN:VCALENDAR")) {
      // The usual cause: the link needs a login, so the host returned its HTML login page.
      return { name, url, ics: null, error: "not a calendar — the link probably needs the owner to be signed in" };
    }
    return { name, url, ics: body };
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError" ? "timed out" : "could not be fetched";
    return { name, url, ics: null, error: message };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchFeeds(feeds: { name: string; url: string }[]): Promise<FeedFetch[]> {
  const results = await Promise.allSettled(feeds.map((feed) => fetchIcs(feed.name, feed.url)));
  return results.map((result, index) =>
    result.status === "fulfilled" ? result.value : { name: feeds[index].name, url: feeds[index].url, ics: null, error: "failed" },
  );
}
