export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || `dashboard-${Date.now()}`;
}

export function formatMoney(minor: number, currency = "PHP", compact = false) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency, notation: compact ? "compact" : "standard", maximumFractionDigits: compact ? 1 : 2 }).format(minor / 100);
}

export function formatDate(value: string | Date | null | undefined, options?: Intl.DateTimeFormatOptions) {
  if (!value) return "Not set";
  const date = value instanceof Date ? value : new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return "Invalid date";
  return new Intl.DateTimeFormat("en", options ?? { month: "short", day: "numeric", year: "numeric" }).format(date);
}

export function relativeTime(value: string | Date | null | undefined) {
  if (!value) return "Never";
  const date = value instanceof Date ? value : new Date(value);
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}

export function safeString(value: unknown, max = 500) {
  return typeof value === "string" ? value.slice(0, max) : "";
}
