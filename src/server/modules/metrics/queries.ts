import { TIME_RANGES, type TimeRange } from "@/shared/constants";
import type { CheckErrorType } from "@/shared/enums";
import type { DayAvailabilityDto, OutageDto, TimeBucketDto } from "@/shared/types";
import { uptimePercent } from "@/shared/uptime";

import { Prisma, prisma } from "../../db";

/**
 * Metric queries. Every function takes the organization id as its first
 * argument and filters on it, including when a monitor id is also given.
 *
 * Windows of up to 7 days are computed from raw checks. Longer windows read
 * the daily rollups, because raw checks are pruned after CHECK_RETENTION_DAYS.
 * Formulas are documented in docs/metrics.md.
 */

export interface Window {
  range: TimeRange;
  from: Date;
  to: Date;
  bucketSeconds: number;
  source: "raw" | "daily";
}

export interface Totals {
  total: number;
  up: number;
  degraded: number;
  down: number;
  avgMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  live: number;
  seed: number;
}

const DAY_MS = 86_400_000;

/** Resolves a named range to concrete, bucket-aligned bounds ending at `now`. */
export function resolveWindow(range: TimeRange, now: Date = new Date()): Window {
  const spec = TIME_RANGES[range];
  const bucketMs = spec.bucketSeconds * 1000;
  // Align the start to a bucket boundary so buckets are stable between refreshes.
  const from = new Date(Math.floor((now.getTime() - spec.seconds * 1000) / bucketMs) * bucketMs + bucketMs);
  return { range, from, to: now, bucketSeconds: spec.bucketSeconds, source: spec.source };
}

/** The window of equal length immediately before `window`, for period-over-period deltas. */
export function previousWindow(window: Window): Window {
  const length = window.to.getTime() - window.from.getTime();
  return { ...window, from: new Date(window.from.getTime() - length), to: window.from };
}

const monitorFilter = (monitorId?: string) =>
  monitorId ? Prisma.sql`AND "monitorId" = ${monitorId}::uuid` : Prisma.empty;

const round = (value: number | null | undefined) => (value === null || value === undefined ? null : Math.round(Number(value)));
const utcDay = (date: Date) => date.toISOString().slice(0, 10);

interface TotalsRow {
  total: number; up: number; degraded: number; down: number;
  avg_ms: number | null; p50: number | null; p95: number | null; p99: number | null;
  live: number; seed: number;
}

export async function loadTotals(organizationId: string, window: Window, monitorId?: string): Promise<Totals> {
  const rows =
    window.source === "raw"
      ? await prisma.$queryRaw<TotalsRow[]>`
          SELECT count(*)::int AS total,
                 count(*) FILTER (WHERE status = 'UP')::int AS up,
                 count(*) FILTER (WHERE status = 'DEGRADED')::int AS degraded,
                 count(*) FILTER (WHERE status = 'DOWN')::int AS down,
                 avg("responseTimeMs") FILTER (WHERE status <> 'DOWN')::float8 AS avg_ms,
                 percentile_disc(0.5) WITHIN GROUP (ORDER BY "responseTimeMs") FILTER (WHERE status <> 'DOWN')::float8 AS p50,
                 percentile_disc(0.95) WITHIN GROUP (ORDER BY "responseTimeMs") FILTER (WHERE status <> 'DOWN')::float8 AS p95,
                 percentile_disc(0.99) WITHIN GROUP (ORDER BY "responseTimeMs") FILTER (WHERE status <> 'DOWN')::float8 AS p99,
                 count(*) FILTER (WHERE origin = 'LIVE')::int AS live,
                 count(*) FILTER (WHERE origin <> 'LIVE')::int AS seed
          FROM "MonitorCheck"
          WHERE "organizationId" = ${organizationId}::uuid ${monitorFilter(monitorId)}
            AND "checkedAt" >= ${window.from} AND "checkedAt" < ${window.to}`
      : // Percentiles cannot be merged exactly across days; this is a check-weighted mean of daily percentiles.
        await prisma.$queryRaw<TotalsRow[]>`
          SELECT coalesce(sum("totalChecks"), 0)::int AS total,
                 coalesce(sum("upChecks"), 0)::int AS up,
                 coalesce(sum("degradedChecks"), 0)::int AS degraded,
                 coalesce(sum("downChecks"), 0)::int AS down,
                 (sum("avgResponseMs"::float8 * ("totalChecks" - "downChecks")) / nullif(sum(("totalChecks" - "downChecks")) FILTER (WHERE "avgResponseMs" IS NOT NULL), 0))::float8 AS avg_ms,
                 (sum("p50ResponseMs"::float8 * ("totalChecks" - "downChecks")) / nullif(sum(("totalChecks" - "downChecks")) FILTER (WHERE "p50ResponseMs" IS NOT NULL), 0))::float8 AS p50,
                 (sum("p95ResponseMs"::float8 * ("totalChecks" - "downChecks")) / nullif(sum(("totalChecks" - "downChecks")) FILTER (WHERE "p95ResponseMs" IS NOT NULL), 0))::float8 AS p95,
                 (sum("p99ResponseMs"::float8 * ("totalChecks" - "downChecks")) / nullif(sum(("totalChecks" - "downChecks")) FILTER (WHERE "p99ResponseMs" IS NOT NULL), 0))::float8 AS p99,
                 coalesce(sum("totalChecks") FILTER (WHERE origin = 'LIVE'), 0)::int AS live,
                 coalesce(sum("totalChecks") FILTER (WHERE origin <> 'LIVE'), 0)::int AS seed
          FROM "MonitorDailyAggregate"
          WHERE "organizationId" = ${organizationId}::uuid ${monitorFilter(monitorId)}
            AND day >= ${utcDay(window.from)}::date AND day <= ${utcDay(window.to)}::date`;

  const row = rows[0];
  return {
    total: row?.total ?? 0,
    up: row?.up ?? 0,
    degraded: row?.degraded ?? 0,
    down: row?.down ?? 0,
    avgMs: round(row?.avg_ms),
    p50Ms: round(row?.p50),
    p95Ms: round(row?.p95),
    p99Ms: round(row?.p99),
    live: row?.live ?? 0,
    seed: row?.seed ?? 0,
  };
}

interface BucketRow {
  t: Date; total: number; up: number; degraded: number; down: number; avg_ms: number | null; p95: number | null;
}

/** A continuous series: buckets with no checks are present, with null metrics. */
export async function loadSeries(organizationId: string, window: Window, monitorId?: string): Promise<TimeBucketDto[]> {
  const rows =
    window.source === "raw"
      ? await prisma.$queryRaw<BucketRow[]>`
          SELECT date_bin(make_interval(secs => ${window.bucketSeconds}), "checkedAt", TIMESTAMPTZ '1970-01-01 00:00:00+00') AS t,
                 count(*)::int AS total,
                 count(*) FILTER (WHERE status = 'UP')::int AS up,
                 count(*) FILTER (WHERE status = 'DEGRADED')::int AS degraded,
                 count(*) FILTER (WHERE status = 'DOWN')::int AS down,
                 avg("responseTimeMs") FILTER (WHERE status <> 'DOWN')::float8 AS avg_ms,
                 percentile_disc(0.95) WITHIN GROUP (ORDER BY "responseTimeMs") FILTER (WHERE status <> 'DOWN')::float8 AS p95
          FROM "MonitorCheck"
          WHERE "organizationId" = ${organizationId}::uuid ${monitorFilter(monitorId)}
            AND "checkedAt" >= ${window.from} AND "checkedAt" < ${window.to}
          GROUP BY 1 ORDER BY 1`
      : await prisma.$queryRaw<BucketRow[]>`
          SELECT (day::timestamp AT TIME ZONE 'UTC') AS t,
                 sum("totalChecks")::int AS total,
                 sum("upChecks")::int AS up,
                 sum("degradedChecks")::int AS degraded,
                 sum("downChecks")::int AS down,
                 (sum("avgResponseMs"::float8 * ("totalChecks" - "downChecks")) / nullif(sum(("totalChecks" - "downChecks")) FILTER (WHERE "avgResponseMs" IS NOT NULL), 0))::float8 AS avg_ms,
                 (sum("p95ResponseMs"::float8 * ("totalChecks" - "downChecks")) / nullif(sum(("totalChecks" - "downChecks")) FILTER (WHERE "p95ResponseMs" IS NOT NULL), 0))::float8 AS p95
          FROM "MonitorDailyAggregate"
          WHERE "organizationId" = ${organizationId}::uuid ${monitorFilter(monitorId)}
            AND day >= ${utcDay(window.from)}::date AND day <= ${utcDay(window.to)}::date
          GROUP BY day ORDER BY day`;

  const byTime = new Map(rows.map((row) => [new Date(row.t).getTime(), row]));
  const bucketMs = window.bucketSeconds * 1000;
  const start = Math.floor(window.from.getTime() / bucketMs) * bucketMs;
  const series: TimeBucketDto[] = [];
  for (let t = start; t < window.to.getTime(); t += bucketMs) {
    const row = byTime.get(t);
    const total = row?.total ?? 0;
    const down = row?.down ?? 0;
    series.push({
      t: new Date(t).toISOString(),
      total,
      up: row?.up ?? 0,
      degraded: row?.degraded ?? 0,
      down,
      uptime: uptimePercent({ total, down }),
      avgMs: round(row?.avg_ms),
      p95Ms: round(row?.p95),
    });
  }
  return series;
}

/** Per-UTC-day availability for the last `days` days, oldest first, gaps included. */
export async function loadDailyAvailability(
  organizationId: string,
  days: number,
  monitorIds?: string[],
  now: Date = new Date(),
): Promise<Map<string, DayAvailabilityDto[]>> {
  const result = new Map<string, DayAvailabilityDto[]>();
  if (monitorIds && monitorIds.length === 0) return result;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (days - 1) * DAY_MS);

  const rows = await prisma.monitorDailyAggregate.findMany({
    where: { organizationId, day: { gte: start }, ...(monitorIds ? { monitorId: { in: monitorIds } } : {}) },
    select: { monitorId: true, day: true, totalChecks: true, downChecks: true, degradedChecks: true },
  });

  const index = new Map<string, (typeof rows)[number]>();
  for (const row of rows) index.set(`${row.monitorId}:${utcDay(row.day)}`, row);
  const ids = monitorIds ?? [...new Set(rows.map((row) => row.monitorId))];
  for (const id of ids) {
    const list: DayAvailabilityDto[] = [];
    for (let offset = 0; offset < days; offset++) {
      const date = utcDay(new Date(start.getTime() + offset * DAY_MS));
      const row = index.get(`${id}:${date}`);
      const total = row?.totalChecks ?? 0;
      const down = row?.downChecks ?? 0;
      list.push({ date, total, down, degraded: row?.degradedChecks ?? 0, uptime: uptimePercent({ total, down }) });
    }
    result.set(id, list);
  }
  return result;
}

export async function loadErrorBreakdown(organizationId: string, window: Window, monitorId?: string) {
  if (window.source !== "raw") return [];
  const rows = await prisma.$queryRaw<{ error_type: CheckErrorType; count: number }[]>`
    SELECT "errorType" AS error_type, count(*)::int AS count
    FROM "MonitorCheck"
    WHERE "organizationId" = ${organizationId}::uuid ${monitorFilter(monitorId)}
      AND "checkedAt" >= ${window.from} AND "checkedAt" < ${window.to}
      AND status = 'DOWN' AND "errorType" IS NOT NULL
    GROUP BY 1 ORDER BY 2 DESC`;
  return rows.map((row) => ({ errorType: row.error_type, count: row.count }));
}

export async function loadTimingBreakdown(organizationId: string, window: Window, monitorId: string) {
  if (window.source !== "raw") return null;
  const rows = await prisma.$queryRaw<{ dns: number | null; connect: number | null; tls: number | null; ttfb: number | null }[]>`
    SELECT avg("dnsMs")::float8 AS dns, avg("connectMs")::float8 AS connect, avg("tlsMs")::float8 AS tls, avg("ttfbMs")::float8 AS ttfb
    FROM "MonitorCheck"
    WHERE "organizationId" = ${organizationId}::uuid AND "monitorId" = ${monitorId}::uuid
      AND "checkedAt" >= ${window.from} AND "checkedAt" < ${window.to} AND status <> 'DOWN' AND "ttfbMs" IS NOT NULL`;
  const row = rows[0];
  if (!row || row.ttfb === null) return null;
  return { dnsMs: round(row.dns), connectMs: round(row.connect), tlsMs: round(row.tls), ttfbMs: round(row.ttfb) };
}

/**
 * Outages as runs of consecutive failed checks (gaps-and-islands). An outage
 * starts at its first failed check and ends at the next successful one; it is
 * still open if no success has followed.
 */
export async function loadOutages(organizationId: string, window: Window, monitorId: string, limit = 20): Promise<OutageDto[]> {
  if (window.source !== "raw") return [];
  const rows = await prisma.$queryRaw<
    { started_at: Date; ended_at: Date | null; failed: number; error_type: CheckErrorType | null; error_message: string | null }[]
  >`
    WITH ordered AS (
      SELECT "checkedAt", status, "errorType", "errorMessage",
             lead("checkedAt") OVER (ORDER BY "checkedAt") AS next_at,
             row_number() OVER (ORDER BY "checkedAt") - row_number() OVER (PARTITION BY (status = 'DOWN') ORDER BY "checkedAt") AS island
      FROM "MonitorCheck"
      WHERE "organizationId" = ${organizationId}::uuid AND "monitorId" = ${monitorId}::uuid
        AND "checkedAt" >= ${window.from} AND "checkedAt" < ${window.to}
    )
    SELECT min("checkedAt") AS started_at,
           max(next_at) FILTER (WHERE next_at IS NOT NULL) AS last_next,
           CASE WHEN bool_or(next_at IS NULL) THEN NULL ELSE max(next_at) END AS ended_at,
           count(*)::int AS failed,
           (array_agg("errorType" ORDER BY "checkedAt"))[1] AS error_type,
           (array_agg("errorMessage" ORDER BY "checkedAt"))[1] AS error_message
    FROM ordered WHERE status = 'DOWN'
    GROUP BY island ORDER BY started_at DESC LIMIT ${limit}`;
  return rows.map((row) => {
    const end = row.ended_at ?? window.to;
    return {
      startedAt: row.started_at.toISOString(),
      endedAt: row.ended_at ? row.ended_at.toISOString() : null,
      durationSeconds: Math.max(0, Math.round((end.getTime() - row.started_at.getTime()) / 1000)),
      failedChecks: row.failed,
      errorType: row.error_type,
      errorMessage: row.error_message,
    };
  });
}

export async function loadFailureHeatmap(organizationId: string, window: Window, monitorId: string) {
  if (window.source !== "raw") return [];
  const rows = await prisma.$queryRaw<{ weekday: number; hour: number; failed: number; total: number }[]>`
    SELECT extract(dow FROM "checkedAt" AT TIME ZONE 'UTC')::int AS weekday,
           extract(hour FROM "checkedAt" AT TIME ZONE 'UTC')::int AS hour,
           count(*) FILTER (WHERE status = 'DOWN')::int AS failed,
           count(*)::int AS total
    FROM "MonitorCheck"
    WHERE "organizationId" = ${organizationId}::uuid AND "monitorId" = ${monitorId}::uuid
      AND "checkedAt" >= ${window.from} AND "checkedAt" < ${window.to}
    GROUP BY 1, 2`;
  return rows;
}

const DISTRIBUTION_BOUNDS = [100, 250, 500, 1000, 2000, 5000];

/** Histogram of successful-check response times. Raw windows only. */
export async function loadResponseDistribution(organizationId: string, window: Window) {
  const labels = ["< 100 ms", "100–250 ms", "250–500 ms", "0.5–1 s", "1–2 s", "2–5 s", "> 5 s"];
  const counts = new Array<number>(labels.length).fill(0);
  if (window.source === "raw") {
    const rows = await prisma.$queryRaw<{ bucket: number; count: number }[]>`
      SELECT width_bucket("responseTimeMs", ${DISTRIBUTION_BOUNDS}::int[]) AS bucket, count(*)::int AS count
      FROM "MonitorCheck"
      WHERE "organizationId" = ${organizationId}::uuid
        AND "checkedAt" >= ${window.from} AND "checkedAt" < ${window.to}
        AND status <> 'DOWN' AND "responseTimeMs" IS NOT NULL
      GROUP BY 1`;
    for (const row of rows) counts[row.bucket] = row.count;
  }
  return labels.map((label, index) => ({ label, upToMs: DISTRIBUTION_BOUNDS[index] ?? null, count: counts[index] ?? 0 }));
}

export interface MonitorWindowStats {
  monitorId: string; total: number; down: number; avgMs: number | null; p95Ms: number | null;
}

/** Per-monitor totals for a window, in one grouped query. */
export async function loadPerMonitorStats(organizationId: string, window: Window, monitorIds?: string[]): Promise<Map<string, MonitorWindowStats>> {
  const map = new Map<string, MonitorWindowStats>();
  if (monitorIds && monitorIds.length === 0) return map;
  const idFilter = monitorIds ? Prisma.sql`AND "monitorId" = ANY(${monitorIds}::uuid[])` : Prisma.empty;
  const rows =
    window.source === "raw"
      ? await prisma.$queryRaw<{ monitor_id: string; total: number; down: number; avg_ms: number | null; p95: number | null }[]>`
          SELECT "monitorId" AS monitor_id, count(*)::int AS total,
                 count(*) FILTER (WHERE status = 'DOWN')::int AS down,
                 avg("responseTimeMs") FILTER (WHERE status <> 'DOWN')::float8 AS avg_ms,
                 percentile_disc(0.95) WITHIN GROUP (ORDER BY "responseTimeMs") FILTER (WHERE status <> 'DOWN')::float8 AS p95
          FROM "MonitorCheck"
          WHERE "organizationId" = ${organizationId}::uuid ${idFilter}
            AND "checkedAt" >= ${window.from} AND "checkedAt" < ${window.to}
          GROUP BY 1`
      : await prisma.$queryRaw<{ monitor_id: string; total: number; down: number; avg_ms: number | null; p95: number | null }[]>`
          SELECT "monitorId" AS monitor_id, sum("totalChecks")::int AS total, sum("downChecks")::int AS down,
                 (sum("avgResponseMs"::float8 * ("totalChecks" - "downChecks")) / nullif(sum(("totalChecks" - "downChecks")) FILTER (WHERE "avgResponseMs" IS NOT NULL), 0))::float8 AS avg_ms,
                 (sum("p95ResponseMs"::float8 * ("totalChecks" - "downChecks")) / nullif(sum(("totalChecks" - "downChecks")) FILTER (WHERE "p95ResponseMs" IS NOT NULL), 0))::float8 AS p95
          FROM "MonitorDailyAggregate"
          WHERE "organizationId" = ${organizationId}::uuid ${idFilter}
            AND day >= ${utcDay(window.from)}::date AND day <= ${utcDay(window.to)}::date
          GROUP BY 1`;
  for (const row of rows) {
    map.set(row.monitor_id, { monitorId: row.monitor_id, total: row.total, down: row.down, avgMs: round(row.avg_ms), p95Ms: round(row.p95) });
  }
  return map;
}

/** Hourly average response time for the last 24 hours, per monitor, for list sparklines. */
export async function loadSparklines(organizationId: string, monitorIds: string[], now: Date = new Date()): Promise<Map<string, (number | null)[]>> {
  const map = new Map<string, (number | null)[]>();
  if (monitorIds.length === 0) return map;
  const hourMs = 3_600_000;
  const end = Math.floor(now.getTime() / hourMs) * hourMs + hourMs;
  const start = end - 24 * hourMs;
  const rows = await prisma.$queryRaw<{ monitor_id: string; t: Date; avg_ms: number | null }[]>`
    SELECT "monitorId" AS monitor_id, date_trunc('hour', "checkedAt") AS t,
           avg("responseTimeMs") FILTER (WHERE status <> 'DOWN')::float8 AS avg_ms
    FROM "MonitorCheck"
    WHERE "organizationId" = ${organizationId}::uuid AND "monitorId" = ANY(${monitorIds}::uuid[])
      AND "checkedAt" >= ${new Date(start)}
    GROUP BY 1, 2`;
  for (const id of monitorIds) map.set(id, new Array<number | null>(24).fill(null));
  for (const row of rows) {
    const index = Math.floor((new Date(row.t).getTime() - start) / hourMs);
    const list = map.get(row.monitor_id);
    if (list && index >= 0 && index < 24) list[index] = round(row.avg_ms);
  }
  return map;
}

/**
 * Recomputes daily rollups from raw checks for every monitor with checks on
 * or after `since`. Idempotent: run it as often as you like.
 */
export async function rollupDailyAggregates(since: Date): Promise<number> {
  return prisma.$executeRaw`
    INSERT INTO "MonitorDailyAggregate" ("monitorId", day, "organizationId", "totalChecks", "upChecks", "degradedChecks", "downChecks",
                                          "avgResponseMs", "minResponseMs", "maxResponseMs", "p50ResponseMs", "p95ResponseMs", "p99ResponseMs", origin, "updatedAt")
    SELECT "monitorId", ("checkedAt" AT TIME ZONE 'UTC')::date AS day, "organizationId",
           count(*)::int,
           count(*) FILTER (WHERE status = 'UP')::int,
           count(*) FILTER (WHERE status = 'DEGRADED')::int,
           count(*) FILTER (WHERE status = 'DOWN')::int,
           round(avg("responseTimeMs") FILTER (WHERE status <> 'DOWN'))::int,
           min("responseTimeMs") FILTER (WHERE status <> 'DOWN'),
           max("responseTimeMs") FILTER (WHERE status <> 'DOWN'),
           percentile_disc(0.5) WITHIN GROUP (ORDER BY "responseTimeMs") FILTER (WHERE status <> 'DOWN'),
           percentile_disc(0.95) WITHIN GROUP (ORDER BY "responseTimeMs") FILTER (WHERE status <> 'DOWN'),
           percentile_disc(0.99) WITHIN GROUP (ORDER BY "responseTimeMs") FILTER (WHERE status <> 'DOWN'),
           (CASE WHEN bool_and(origin = 'LIVE') THEN 'LIVE' WHEN bool_and(origin = 'SEED') THEN 'SEED' ELSE 'MIXED' END)::"DataOrigin",
           now()
    FROM "MonitorCheck"
    WHERE "checkedAt" >= ${since}
    GROUP BY "monitorId", "organizationId", ("checkedAt" AT TIME ZONE 'UTC')::date
    ON CONFLICT ("monitorId", day) DO UPDATE SET
      "totalChecks" = EXCLUDED."totalChecks", "upChecks" = EXCLUDED."upChecks", "degradedChecks" = EXCLUDED."degradedChecks",
      "downChecks" = EXCLUDED."downChecks", "avgResponseMs" = EXCLUDED."avgResponseMs", "minResponseMs" = EXCLUDED."minResponseMs",
      "maxResponseMs" = EXCLUDED."maxResponseMs", "p50ResponseMs" = EXCLUDED."p50ResponseMs", "p95ResponseMs" = EXCLUDED."p95ResponseMs",
      "p99ResponseMs" = EXCLUDED."p99ResponseMs", origin = EXCLUDED.origin, "updatedAt" = now()`;
}
