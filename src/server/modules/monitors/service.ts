import { type TimeRange } from "@/shared/constants";
import { ActivityLevel, ActivityType, IncidentStatus, MonitorStatus } from "@/shared/enums";
import {
  type CreateMonitorInput, type ListChecksQuery, type ListMonitorsQuery, monitorCrossFieldIssues,
  type TestMonitorInput, type UpdateMonitorInput,
} from "@/shared/schemas/monitor";
import { normalizeStatusExpression } from "@/shared/status-codes";
import type {
  CheckDto, CursorPage, DayAvailabilityDto, MonitorDto, MonitorListItemDto, MonitorStatsDto, Paginated, TestCheckResultDto,
} from "@/shared/types";
import { estimatedDowntimeSeconds, uptimePercent } from "@/shared/uptime";

import { diffFields, recordAudit } from "../../audit";
import { isUniqueViolation, type Prisma, prisma } from "../../db";
import { getEnv } from "../../env";
import { conflict, fieldError, notFound, validationFailed } from "../../errors";
import { performCheck } from "../../monitoring/http-check";
import { assertTargetAllowed, SsrfBlockedError } from "../../monitoring/ssrf";
import { publish } from "../../realtime/publisher";
import { authorize, type OrgContext } from "../../tenancy";
import { recordActivity } from "../activity/record";
import { iso, isoOrNull } from "../mappers";
import {
  loadDailyAvailability, loadErrorBreakdown, loadFailureHeatmap, loadOutages, loadPerMonitorStats, loadSeries, loadSparklines,
  loadTimingBreakdown, loadTotals, resolveWindow,
} from "../metrics/queries";

type MonitorRow = Prisma.MonitorGetPayload<object>;

/** `nulls: "last"` is only valid on nullable columns. */
const NULLABLE_SORT = new Set<string>(["lastCheckedAt", "lastResponseTimeMs"]);

export function toMonitorDto(row: MonitorRow): MonitorDto {
  return {
    id: row.id, name: row.name, url: row.url, kind: row.kind, method: row.method, category: row.category,
    intervalSeconds: row.intervalSeconds, timeoutMs: row.timeoutMs, expectedStatusCodes: row.expectedStatusCodes,
    followRedirects: row.followRedirects, retries: row.retries, degradedThresholdMs: row.degradedThresholdMs,
    failureThreshold: row.failureThreshold, recoveryThreshold: row.recoveryThreshold, autoIncident: row.autoIncident,
    incidentSeverity: row.incidentSeverity, enabled: row.enabled, status: row.status,
    consecutiveFailures: row.consecutiveFailures, consecutiveSuccesses: row.consecutiveSuccesses,
    lastCheckedAt: isoOrNull(row.lastCheckedAt), nextCheckAt: row.enabled ? iso(row.nextCheckAt) : null,
    lastStatusChangeAt: isoOrNull(row.lastStatusChangeAt), lastSuccessAt: isoOrNull(row.lastSuccessAt),
    lastFailureAt: isoOrNull(row.lastFailureAt), lastResponseTimeMs: row.lastResponseTimeMs, lastStatusCode: row.lastStatusCode,
    lastErrorType: row.lastErrorType, lastErrorMessage: row.lastErrorMessage, isSample: row.isSample,
    createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt),
  };
}

async function assertUrlAllowed(url: string): Promise<void> {
  try {
    await assertTargetAllowed(url);
  } catch (error) {
    if (error instanceof SsrfBlockedError) throw fieldError("url", error.message);
    throw error;
  }
}

function assertInterval(intervalSeconds: number): void {
  const min = getEnv().MONITOR_MIN_INTERVAL_SECONDS;
  if (intervalSeconds < min) throw fieldError("intervalSeconds", `The shortest interval on this instance is ${min} seconds.`);
}

async function findMonitor(ctx: OrgContext, monitorId: string): Promise<MonitorRow> {
  // Always by id AND organization: an id from another tenant is simply "not found".
  const monitor = await prisma.monitor.findFirst({ where: { id: monitorId, organizationId: ctx.organization.id } });
  if (!monitor) throw notFound("Monitor");
  return monitor;
}

export async function listMonitors(ctx: OrgContext, query: ListMonitorsQuery): Promise<Paginated<MonitorListItemDto>> {
  authorize(ctx, "monitor:read");
  const where: Prisma.MonitorWhereInput = {
    organizationId: ctx.organization.id,
    ...(query.q ? { OR: [{ name: { contains: query.q, mode: "insensitive" } }, { url: { contains: query.q, mode: "insensitive" } }] } : {}),
    ...(query.status?.length ? { status: { in: query.status } } : {}),
    ...(query.kind ? { kind: query.kind } : {}),
    ...(query.category ? { category: query.category } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.monitor.count({ where }),
    prisma.monitor.findMany({
      where,
      // Sort field comes from a schema enum, never from raw input. `id` makes the order total.
      orderBy: [
        (NULLABLE_SORT.has(query.sort) ? { [query.sort]: { sort: query.direction, nulls: "last" } } : { [query.sort]: query.direction }) as Prisma.MonitorOrderByWithRelationInput,
        { id: "asc" },
      ],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  const ids = rows.map((row) => row.id);
  const [stats, sparklines, open] = await Promise.all([
    loadPerMonitorStats(ctx.organization.id, resolveWindow("24h"), ids),
    loadSparklines(ctx.organization.id, ids),
    ids.length
      ? prisma.incidentMonitor.groupBy({
          by: ["monitorId"],
          where: { organizationId: ctx.organization.id, monitorId: { in: ids }, incident: { status: { not: IncidentStatus.RESOLVED } } },
          _count: true,
        })
      : Promise.resolve([]),
  ]);
  const openByMonitor = new Map(open.map((row) => [row.monitorId, row._count]));
  return {
    items: rows.map((row) => {
      const stat = stats.get(row.id);
      return {
        ...toMonitorDto(row),
        uptime24h: stat ? uptimePercent(stat) : null,
        avgResponseMs24h: stat?.avgMs ?? null,
        sparkline: sparklines.get(row.id) ?? [],
        openIncidents: openByMonitor.get(row.id) ?? 0,
      };
    }),
    page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

export async function listCategories(ctx: OrgContext): Promise<string[]> {
  authorize(ctx, "monitor:read");
  const rows = await prisma.monitor.findMany({
    where: { organizationId: ctx.organization.id, category: { not: null } }, distinct: ["category"], select: { category: true }, orderBy: { category: "asc" },
  });
  return rows.map((row) => row.category).filter((value): value is string => Boolean(value));
}

export async function getMonitor(ctx: OrgContext, monitorId: string): Promise<MonitorDto> {
  authorize(ctx, "monitor:read");
  return toMonitorDto(await findMonitor(ctx, monitorId));
}

export async function createMonitor(ctx: OrgContext, input: CreateMonitorInput): Promise<MonitorDto> {
  authorize(ctx, "monitor:write");
  assertInterval(input.intervalSeconds);
  await assertUrlAllowed(input.url);

  const limit = getEnv().MONITOR_MAX_PER_ORG;
  try {
    const monitor = await prisma.$transaction(async (tx) => {
      if ((await tx.monitor.count({ where: { organizationId: ctx.organization.id } })) >= limit) {
        throw conflict(`This organization has reached its limit of ${limit} monitors.`);
      }
      const created = await tx.monitor.create({
        data: {
          ...input,
          expectedStatusCodes: normalizeStatusExpression(input.expectedStatusCodes),
          organizationId: ctx.organization.id,
          createdById: ctx.actor.userId,
          status: input.enabled ? MonitorStatus.PENDING : MonitorStatus.PAUSED,
          // Due immediately: the first result should arrive within one scheduler tick.
          nextCheckAt: new Date(),
        },
      });
      await recordAudit(tx, ctx, {
        action: "monitor.created",
        target: { type: "monitor", id: created.id, label: created.name },
        metadata: { url: created.url, method: created.method, intervalSeconds: created.intervalSeconds },
      });
      await recordActivity(tx, {
        organizationId: ctx.organization.id, type: ActivityType.MONITOR_CREATED, level: ActivityLevel.INFO,
        title: `${created.name} was added`, description: `Created by ${ctx.actor.name}.`, monitorId: created.id,
      });
      return created;
    });
    await publish(ctx.organization.id, { type: "monitor.changed", monitorId: monitor.id, change: "created" }, { type: "activity.created" });
    return toMonitorDto(monitor);
  } catch (error) {
    if (isUniqueViolation(error, "name")) throw conflict("A monitor with that name already exists.", { name: ["A monitor with that name already exists."] });
    throw error;
  }
}

const AUDITED_FIELDS: (keyof MonitorRow & string)[] = [
  "name", "url", "kind", "method", "category", "intervalSeconds", "timeoutMs", "expectedStatusCodes", "followRedirects", "retries",
  "degradedThresholdMs", "failureThreshold", "recoveryThreshold", "autoIncident", "incidentSeverity", "enabled",
];

export async function updateMonitor(ctx: OrgContext, monitorId: string, input: UpdateMonitorInput): Promise<MonitorDto> {
  authorize(ctx, "monitor:write");
  const before = await findMonitor(ctx, monitorId);

  // Cross-field rules are checked against the monitor as it will be, not just the patch.
  const merged = { ...before, ...input };
  const issues = monitorCrossFieldIssues(merged);
  if (issues.length > 0) {
    throw validationFailed(Object.fromEntries(issues.map((issue) => [issue.path, [issue.message]])));
  }
  if (input.intervalSeconds !== undefined) assertInterval(input.intervalSeconds);
  if (input.url !== undefined && input.url !== before.url) await assertUrlAllowed(input.url);

  const enabling = input.enabled === true && !before.enabled;
  const disabling = input.enabled === false && before.enabled;
  const scheduleChanged = enabling || (input.url !== undefined && input.url !== before.url) || input.intervalSeconds !== undefined;

  try {
    const monitor = await prisma.$transaction(async (tx) => {
      const updated = await tx.monitor.update({
        where: { id: before.id },
        data: {
          ...input,
          ...(input.expectedStatusCodes ? { expectedStatusCodes: normalizeStatusExpression(input.expectedStatusCodes) } : {}),
          ...(disabling ? { status: MonitorStatus.PAUSED, lastStatusChangeAt: new Date() } : {}),
          // Resuming starts from a clean slate: stale counters must not trip an immediate outage.
          ...(enabling ? { status: MonitorStatus.PENDING, consecutiveFailures: 0, consecutiveSuccesses: 0, lastStatusChangeAt: new Date() } : {}),
          ...(scheduleChanged && !disabling ? { nextCheckAt: new Date() } : {}),
        },
      });
      const changes = diffFields(before, input as Partial<MonitorRow>, AUDITED_FIELDS);
      if (Object.keys(changes).length > 0) {
        const action = enabling ? "monitor.resumed" : disabling ? "monitor.paused" : "monitor.updated";
        await recordAudit(tx, ctx, { action, target: { type: "monitor", id: updated.id, label: updated.name }, metadata: { changes } });
      }
      if (enabling || disabling) {
        await recordActivity(tx, {
          organizationId: ctx.organization.id,
          type: enabling ? ActivityType.MONITOR_RESUMED : ActivityType.MONITOR_PAUSED,
          level: ActivityLevel.INFO,
          title: `${updated.name} was ${enabling ? "resumed" : "paused"}`,
          description: `By ${ctx.actor.name}.`,
          monitorId: updated.id,
        });
      }
      return updated;
    });
    await publish(ctx.organization.id, { type: "monitor.changed", monitorId: monitor.id, change: "updated" });
    return toMonitorDto(monitor);
  } catch (error) {
    if (isUniqueViolation(error, "name")) throw conflict("A monitor with that name already exists.", { name: ["A monitor with that name already exists."] });
    throw error;
  }
}

export async function deleteMonitor(ctx: OrgContext, monitorId: string): Promise<void> {
  authorize(ctx, "monitor:delete");
  const monitor = await findMonitor(ctx, monitorId);
  await prisma.$transaction(async (tx) => {
    // Checks, rollups, and status-page links cascade. Incidents survive without the link.
    await tx.monitor.delete({ where: { id: monitor.id } });
    await recordAudit(tx, ctx, { action: "monitor.deleted", target: { type: "monitor", id: monitor.id, label: monitor.name }, metadata: { url: monitor.url } });
  });
  await publish(ctx.organization.id, { type: "monitor.changed", monitorId: monitor.id, change: "deleted" });
}

/** Asks the scheduler to run a check as soon as possible. */
export async function requestCheckNow(ctx: OrgContext, monitorId: string): Promise<MonitorDto> {
  authorize(ctx, "monitor:write");
  const monitor = await findMonitor(ctx, monitorId);
  if (!monitor.enabled) throw conflict("Resume the monitor before running a check.");
  const updated = await prisma.monitor.update({ where: { id: monitor.id }, data: { nextCheckAt: new Date() } });
  return toMonitorDto(updated);
}

/** A one-off check for the monitor form. Goes through the same SSRF guard as scheduled checks. */
export async function testMonitor(ctx: OrgContext, input: TestMonitorInput): Promise<TestCheckResultDto> {
  authorize(ctx, "monitor:write");
  const outcome = await performCheck({ ...input, retries: 0, degradedThresholdMs: null });
  return {
    ok: outcome.ok, status: outcome.status, statusCode: outcome.statusCode, responseTimeMs: outcome.responseTimeMs,
    errorType: outcome.errorType, errorMessage: outcome.errorMessage, finalUrl: outcome.finalUrl, redirects: outcome.redirects,
    timings: { dnsMs: outcome.dnsMs, connectMs: outcome.connectMs, tlsMs: outcome.tlsMs, ttfbMs: outcome.ttfbMs },
  };
}

export async function listChecks(ctx: OrgContext, monitorId: string, query: ListChecksQuery): Promise<CursorPage<CheckDto>> {
  authorize(ctx, "monitor:read");
  const monitor = await findMonitor(ctx, monitorId);
  const rows = await prisma.monitorCheck.findMany({
    where: { monitorId: monitor.id, organizationId: ctx.organization.id, ...(query.status?.length ? { status: { in: query.status } } : {}) },
    orderBy: [{ checkedAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, query.limit);
  return {
    items: page.map((row) => ({
      id: row.id, status: row.status, statusCode: row.statusCode, responseTimeMs: row.responseTimeMs, dnsMs: row.dnsMs,
      connectMs: row.connectMs, tlsMs: row.tlsMs, ttfbMs: row.ttfbMs, errorType: row.errorType, errorMessage: row.errorMessage,
      attempts: row.attempts, origin: row.origin, checkedAt: iso(row.checkedAt),
    })),
    nextCursor: rows.length > query.limit ? (page[page.length - 1]?.id ?? null) : null,
  };
}

export async function getMonitorStats(ctx: OrgContext, monitorId: string, range: TimeRange): Promise<MonitorStatsDto> {
  authorize(ctx, "monitor:read");
  const monitor = await findMonitor(ctx, monitorId);
  const org = ctx.organization.id;
  const window = resolveWindow(range);
  const [totals, series, errorBreakdown, timing, outages, failureHeatmap] = await Promise.all([
    loadTotals(org, window, monitor.id),
    loadSeries(org, window, monitor.id),
    loadErrorBreakdown(org, window, monitor.id),
    loadTimingBreakdown(org, window, monitor.id),
    loadOutages(org, window, monitor.id),
    loadFailureHeatmap(org, window, monitor.id),
  ]);
  return {
    range, from: iso(window.from), to: iso(window.to), bucketSeconds: window.bucketSeconds, source: window.source,
    totalChecks: totals.total, failedChecks: totals.down, degradedChecks: totals.degraded,
    uptime: uptimePercent(totals), avgResponseMs: totals.avgMs, p50ResponseMs: totals.p50Ms, p95ResponseMs: totals.p95Ms, p99ResponseMs: totals.p99Ms,
    estimatedDowntimeSeconds: estimatedDowntimeSeconds(totals.down, monitor.intervalSeconds),
    series, errorBreakdown, timing, outages, failureHeatmap, origin: { live: totals.live, seed: totals.seed },
  };
}

export async function getMonitorAvailability(ctx: OrgContext, monitorId: string, days = 90): Promise<DayAvailabilityDto[]> {
  authorize(ctx, "monitor:read");
  const monitor = await findMonitor(ctx, monitorId);
  const map = await loadDailyAvailability(ctx.organization.id, days, [monitor.id]);
  return map.get(monitor.id) ?? [];
}
