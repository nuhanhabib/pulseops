import type { TimeRange } from "@/shared/constants";
import { IncidentSeverity, IncidentStatus, MonitorStatus } from "@/shared/enums";
import type { AnalyticsDto, DashboardDto, DayAvailabilityDto } from "@/shared/types";
import { uptimePercent } from "@/shared/uptime";

import { prisma } from "../../db";
import { authorize, type OrgContext } from "../../tenancy";
import { iso } from "../mappers";
import {
  loadDailyAvailability, loadPerMonitorStats, loadResponseDistribution, loadSeries, loadTotals, previousWindow, resolveWindow, type Window,
} from "../metrics/queries";

async function incidentStats(organizationId: string, window: Window) {
  const [opened, resolvedRows] = await Promise.all([
    prisma.incident.count({ where: { organizationId, startedAt: { gte: window.from, lt: window.to } } }),
    prisma.incident.findMany({
      where: { organizationId, resolvedAt: { gte: window.from, lt: window.to } },
      select: { startedAt: true, resolvedAt: true },
    }),
  ]);
  const durations = resolvedRows.map((row) => ((row.resolvedAt as Date).getTime() - row.startedAt.getTime()) / 1000);
  // Mean time to resolve: the average of (resolvedAt − startedAt) over incidents resolved in the window.
  const mttrSeconds = durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null;
  return { opened, resolved: resolvedRows.length, mttrSeconds };
}

export async function getDashboard(ctx: OrgContext, range: TimeRange): Promise<DashboardDto> {
  authorize(ctx, "monitor:read");
  const org = ctx.organization.id;
  const window = resolveWindow(range);
  const previous = previousWindow(window);

  const [statusCounts, totals, previousTotals, series, active, incidents, previousIncidents] = await Promise.all([
    prisma.monitor.groupBy({ by: ["status"], where: { organizationId: org }, _count: true }),
    loadTotals(org, window),
    loadTotals(org, previous),
    loadSeries(org, window),
    prisma.incident.count({ where: { organizationId: org, status: { not: IncidentStatus.RESOLVED } } }),
    incidentStats(org, window),
    incidentStats(org, previous),
  ]);

  const count = (status: MonitorStatus) => statusCounts.find((row) => row.status === status)?._count ?? 0;
  const monitors = {
    up: count(MonitorStatus.UP), degraded: count(MonitorStatus.DEGRADED), down: count(MonitorStatus.DOWN),
    paused: count(MonitorStatus.PAUSED), pending: count(MonitorStatus.PENDING), total: 0,
  };
  monitors.total = monitors.up + monitors.degraded + monitors.down + monitors.paused + monitors.pending;

  return {
    range, from: iso(window.from), to: iso(window.to), bucketSeconds: window.bucketSeconds, monitors,
    uptime: { value: uptimePercent(totals), previous: uptimePercent(previousTotals) },
    avgResponseMs: { value: totals.avgMs, previous: previousTotals.avgMs },
    p95ResponseMs: totals.p95Ms,
    checks: { total: totals.total, failed: totals.down },
    incidents: {
      active, opened: { value: incidents.opened, previous: previousIncidents.opened },
      resolved: incidents.resolved, mttrSeconds: incidents.mttrSeconds,
    },
    series, origin: { live: totals.live, seed: totals.seed },
  };
}

const DAY_MS = 86_400_000;

export async function getAnalytics(ctx: OrgContext, range: TimeRange): Promise<AnalyticsDto> {
  authorize(ctx, "monitor:read");
  const org = ctx.organization.id;
  const window = resolveWindow(range);
  const previous = previousWindow(window);
  const days = Math.max(1, Math.round((window.to.getTime() - window.from.getTime()) / DAY_MS));

  const [totals, previousTotals, series, distribution, monitors, perMonitor, incidents, incidentCounts, incidentStatsNow, incidentStatsPrev, dailyByMonitor] =
    await Promise.all([
      loadTotals(org, window),
      loadTotals(org, previous),
      loadSeries(org, window),
      loadResponseDistribution(org, window),
      prisma.monitor.findMany({ where: { organizationId: org }, select: { id: true, name: true, kind: true, status: true }, orderBy: { name: "asc" } }),
      loadPerMonitorStats(org, window),
      prisma.incident.findMany({
        where: { organizationId: org, startedAt: { gte: window.from, lt: window.to } },
        select: { startedAt: true, severity: true },
      }),
      prisma.incidentMonitor.groupBy({
        by: ["monitorId"], where: { organizationId: org, incident: { startedAt: { gte: window.from, lt: window.to } } }, _count: true,
      }),
      incidentStats(org, window),
      incidentStats(org, previous),
      loadDailyAvailability(org, Math.max(days, 7)),
    ]);

  // Incident frequency uses daily buckets, or hourly ones for the 24-hour view.
  const frequencyBucketSeconds = range === "24h" ? 3600 : 86_400;
  const bucketMs = frequencyBucketSeconds * 1000;
  const start = Math.floor(window.from.getTime() / bucketMs) * bucketMs;
  const frequency = new Map<number, { t: string; critical: number; high: number; medium: number; low: number }>();
  for (let t = start; t < window.to.getTime(); t += bucketMs) {
    frequency.set(t, { t: new Date(t).toISOString(), critical: 0, high: 0, medium: 0, low: 0 });
  }
  const severityKey = { CRITICAL: "critical", HIGH: "high", MEDIUM: "medium", LOW: "low" } as const;
  for (const incident of incidents) {
    const bucket = frequency.get(Math.floor(incident.startedAt.getTime() / bucketMs) * bucketMs);
    if (bucket) bucket[severityKey[incident.severity]] += 1;
  }

  // Organization-wide daily availability: sum the counts across monitors, then divide.
  const dailyTotals = new Map<string, { total: number; down: number; degraded: number }>();
  for (const list of dailyByMonitor.values()) {
    for (const day of list) {
      const entry = dailyTotals.get(day.date) ?? { total: 0, down: 0, degraded: 0 };
      entry.total += day.total; entry.down += day.down; entry.degraded += day.degraded;
      dailyTotals.set(day.date, entry);
    }
  }
  const daily: DayAvailabilityDto[] = [...dailyTotals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-Math.max(days, 7))
    .map(([date, entry]) => ({ date, ...entry, uptime: uptimePercent(entry) }));

  const weeklyTotals = new Map<string, { total: number; down: number }>();
  for (const day of daily) {
    const date = new Date(`${day.date}T00:00:00Z`);
    const monday = new Date(date.getTime() - ((date.getUTCDay() + 6) % 7) * DAY_MS).toISOString().slice(0, 10);
    const entry = weeklyTotals.get(monday) ?? { total: 0, down: 0 };
    entry.total += day.total; entry.down += day.down;
    weeklyTotals.set(monday, entry);
  }

  const incidentsByMonitor = new Map(incidentCounts.map((row) => [row.monitorId, row._count]));
  return {
    range, from: iso(window.from), to: iso(window.to), bucketSeconds: window.bucketSeconds, source: window.source,
    uptime: { value: uptimePercent(totals), previous: uptimePercent(previousTotals) },
    avgResponseMs: { value: totals.avgMs, previous: previousTotals.avgMs },
    p95ResponseMs: totals.p95Ms, totalChecks: totals.total, failedChecks: totals.down,
    series, responseDistribution: distribution,
    monitors: monitors.map((monitor) => {
      const stat = perMonitor.get(monitor.id);
      return {
        ...monitor, totalChecks: stat?.total ?? 0, failedChecks: stat?.down ?? 0, uptime: stat ? uptimePercent(stat) : null,
        avgResponseMs: stat?.avgMs ?? null, p95ResponseMs: stat?.p95Ms ?? null, incidents: incidentsByMonitor.get(monitor.id) ?? 0,
      };
    }),
    incidents: {
      total: { value: incidentStatsNow.opened, previous: incidentStatsPrev.opened },
      resolved: incidentStatsNow.resolved,
      mttrSeconds: { value: incidentStatsNow.mttrSeconds, previous: incidentStatsPrev.mttrSeconds },
      bySeverity: Object.values(IncidentSeverity).map((severity) => ({ severity, count: incidents.filter((row) => row.severity === severity).length })),
      frequency: [...frequency.values()], frequencyBucketSeconds,
    },
    daily,
    weekly: [...weeklyTotals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([weekStart, entry]) => ({ weekStart, ...entry, uptime: uptimePercent(entry) })),
    origin: { live: totals.live, seed: totals.seed },
  };
}
