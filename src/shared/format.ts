/** Locale-stable formatting helpers. No `Date.now()` here: callers pass `now`. */

const numberFormat = new Intl.NumberFormat("en-US");
const compactFormat = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return numberFormat.format(value);
}

/** 1,284 / 12.9K / 4.2M — full below ten thousand, compact above. */
export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return Math.abs(value) < 10_000 ? numberFormat.format(Math.round(value)) : compactFormat.format(value);
}

/** Milliseconds as "184 ms" or "2.41 s". */
export function formatMs(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(value < 10_000 ? 2 : 1)} s`;
}

/** A duration in seconds as "42s", "12m 08s", "3h 05m", or "2d 4h". */
export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(totalSeconds)) return "—";
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/** Coarser, for prose: "42 seconds", "12 minutes", "3 hours", "2 days". */
export function formatDurationWords(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? "" : "s"}`;
  if (seconds < 60) return plural(seconds, "second");
  if (seconds < 3600) return plural(Math.round(seconds / 60), "minute");
  if (seconds < 86_400) return plural(Math.round(seconds / 3600), "hour");
  return plural(Math.round(seconds / 86_400), "day");
}

export function formatInterval(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return seconds % 60 === 0 ? `${seconds / 60}m` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return seconds % 3600 === 0 ? `${seconds / 3600}h` : `${(seconds / 3600).toFixed(1)}h`;
}

/** "just now", "4m ago", "3h ago", "2d ago", then a calendar date. */
export function formatRelative(date: Date | string | null | undefined, now: Date): string {
  if (!date) return "—";
  const then = typeof date === "string" ? new Date(date) : date;
  const deltaSeconds = Math.round((now.getTime() - then.getTime()) / 1000);
  const future = deltaSeconds < 0;
  const seconds = Math.abs(deltaSeconds);
  const wrap = (text: string) => (future ? `in ${text}` : `${text} ago`);
  if (seconds < 10) return future ? "in a moment" : "just now";
  if (seconds < 60) return wrap(`${seconds}s`);
  if (seconds < 3600) return wrap(`${Math.floor(seconds / 60)}m`);
  if (seconds < 86_400) return wrap(`${Math.floor(seconds / 3600)}h`);
  if (seconds < 7 * 86_400) return wrap(`${Math.floor(seconds / 86_400)}d`);
  return formatDate(then);
}

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const dateTimeFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const fullDateTimeFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZoneName: "short",
});
const timeFormat = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const dayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const utcDayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

const toDate = (value: Date | string) => (typeof value === "string" ? new Date(value) : value);

export const formatDate = (value: Date | string) => dateFormat.format(toDate(value));
export const formatDateTime = (value: Date | string) => dateTimeFormat.format(toDate(value));
export const formatFullDateTime = (value: Date | string) => fullDateTimeFormat.format(toDate(value));
export const formatTime = (value: Date | string) => timeFormat.format(toDate(value));
export const formatDay = (value: Date | string) => dayFormat.format(toDate(value));
/** For values that are UTC calendar days, such as daily rollups. */
export const formatUtcDay = (value: Date | string) => utcDayFormat.format(toDate(value));

export function formatPercent(value: number | null | undefined, fractionDigits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toFixed(fractionDigits)}%`;
}

/** "1 monitor" / "3 monitors". */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** Host and path without the scheme, for compact display. */
export function displayUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.host}${path}`;
  } catch {
    return url;
  }
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
