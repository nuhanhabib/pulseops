"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { Activity, ExternalLink, Pause, Pencil, Play, Siren, Trash2, Zap } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ChartCard } from "@/components/charts/chart-card";
import { FailureHeatmap, RankedBars, StatTile, UptimeBars } from "@/components/charts/figures";
import { TimeSeriesChart, timeFormatters } from "@/components/charts/time-series";
import { useBreadcrumbTitle } from "@/components/layout/breadcrumbs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { Duration, RelativeTime } from "@/components/ui/relative-time";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { CheckStatusBadge, IncidentStatusBadge, MonitorStatusBadge, SampleBadge, SeverityBadge, StatusDot } from "@/components/ui/status";
import { Table, TableContainer, Td, Th, Tr } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { orgKey, useOrg } from "@/features/org/org-context";
import { OriginNote, RangePicker, useOrgQuery } from "@/features/shared";
import { api } from "@/lib/api-client";
import { DEFAULT_TIME_RANGE, TIME_RANGES, type TimeRange } from "@/shared/constants";
import { formatDateTime, formatDuration, formatFullDateTime, formatInterval, formatMs, formatNumber } from "@/shared/format";
import type { CheckDto, CursorPage, DayAvailabilityDto, IncidentListItemDto, MonitorDto, MonitorStatsDto, Paginated } from "@/shared/types";
import { formatUptime, uptimePercent } from "@/shared/uptime";

import { useMonitorActions } from "./monitors-page";

const ERROR_LABELS: Record<string, string> = {
  TIMEOUT: "Timeout", DNS: "DNS failure", TLS: "TLS error", CONNECTION: "Connection failed", HTTP_STATUS: "Unexpected status", REDIRECT: "Redirect problem", BLOCKED: "Blocked by policy", UNKNOWN: "Unknown",
};

function ChecksTable({ monitorId }: { monitorId: string }) {
  const org = useOrg();
  const checks = useInfiniteQuery({
    queryKey: orgKey(org.organization.slug, "monitor", monitorId, "checks"),
    queryFn: ({ pageParam }) => api.get<CursorPage<CheckDto>>(`${org.api}/monitors/${monitorId}/checks`, { limit: 40, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // Refetching every loaded page on each live check would be wasteful; keep to the first.
    maxPages: 10,
  });
  if (checks.isPending) return <div className="flex flex-col gap-2 p-5">{Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-8" />)}</div>;
  if (checks.isError) return <ErrorState onRetry={() => checks.refetch()} />;
  const rows = checks.data.pages.flatMap((page) => page.items);
  if (rows.length === 0) return <EmptyState icon={Activity} title="No checks yet" description="The first result appears a few seconds after a monitor is created or resumed." />;
  return (
    <>
      <TableContainer>
        <Table>
          <thead><tr><Th>Time</Th><Th>Result</Th><Th className="text-right">Status</Th><Th className="text-right">Response</Th><Th className="hidden text-right md:table-cell">DNS</Th><Th className="hidden text-right md:table-cell">Connect</Th><Th className="hidden text-right md:table-cell">TLS</Th><Th className="hidden lg:table-cell">Detail</Th></tr></thead>
          <tbody>
            {rows.map((check) => (
              <Tr key={check.id}>
                <Td className="h-10 whitespace-nowrap text-text-2 tabular"><time dateTime={check.checkedAt} title={formatFullDateTime(check.checkedAt)}>{formatDateTime(check.checkedAt)}</time></Td>
                <Td className="h-10"><span className="flex items-center gap-2"><CheckStatusBadge status={check.status} />{check.origin === "SEED" && <SampleBadge />}</span></Td>
                <Td className="h-10 text-right font-mono text-xs">{check.statusCode ?? "—"}</Td>
                <Td className="h-10 text-right tabular">{formatMs(check.responseTimeMs)}</Td>
                <Td className="hidden h-10 text-right text-text-2 tabular md:table-cell">{check.dnsMs ?? "—"}</Td>
                <Td className="hidden h-10 text-right text-text-2 tabular md:table-cell">{check.connectMs ?? "—"}</Td>
                <Td className="hidden h-10 text-right text-text-2 tabular md:table-cell">{check.tlsMs ?? "—"}</Td>
                <Td className="hidden h-10 max-w-xs truncate text-xs text-muted lg:table-cell" title={check.errorMessage ?? undefined}>{check.errorMessage ?? (check.attempts > 1 ? `Succeeded on attempt ${check.attempts}` : "")}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableContainer>
      {checks.hasNextPage && <div className="border-t border-border p-3 text-center"><Button onClick={() => checks.fetchNextPage()} loading={checks.isFetchingNextPage}>Load older checks</Button></div>}
    </>
  );
}

function ConfigRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-baseline justify-between gap-4 border-b border-border py-2 text-sm last:border-b-0"><dt className="shrink-0 text-muted">{label}</dt><dd className="min-w-0 truncate text-right text-text">{children}</dd></div>;
}

export function MonitorDetailPage({ monitorId }: { monitorId: string }) {
  const org = useOrg();
  const router = useRouter();
  const [range, setRange] = useState<TimeRange>(DEFAULT_TIME_RANGE);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const actions = useMonitorActions();

  const monitorQuery = useOrgQuery<MonitorDto>(["monitor", monitorId, "detail"], `/monitors/${monitorId}`);
  const statsQuery = useOrgQuery<{ stats: MonitorStatsDto; availability: DayAvailabilityDto[] }>(["monitor", monitorId, "stats"], `/monitors/${monitorId}/stats`, { range });
  const incidents = useOrgQuery<Paginated<IncidentListItemDto>>(["incidents", "for-monitor", monitorId], "/incidents", { monitorId, pageSize: 10 });
  const monitor = monitorQuery.data;
  useBreadcrumbTitle(monitor?.name);

  if (monitorQuery.isError) {
    return <PageContainer><Card><ErrorState title="Monitor not found" description="It may have been deleted, or you may not have access to it." onRetry={() => monitorQuery.refetch()} /></Card></PageContainer>;
  }
  if (!monitor) return <PageContainer><Skeleton className="mb-6 h-8 w-64" /><div className="grid gap-4 sm:grid-cols-4">{[0, 1, 2, 3].map((tile) => <Skeleton key={tile} className="h-24" />)}</div><Skeleton className="mt-4 h-72" /></PageContainer>;

  const stats = statsQuery.data?.stats;
  const availability = statsQuery.data?.availability ?? [];
  const label = TIME_RANGES[range].label.toLowerCase();
  const utc = TIME_RANGES[range].source === "daily";
  const time = stats ? timeFormatters(stats.bucketSeconds, utc) : null;
  const ninety = availability.reduce((sum, day) => ({ total: sum.total + day.total, down: sum.down + day.down }), { total: 0, down: 0 });
  const canWrite = org.can("monitor:write");

  return (
    <PageContainer>
      <PageHeader
        title={<><StatusDot status={monitor.status} live />{monitor.name}<MonitorStatusBadge status={monitor.status} />{monitor.isSample && <SampleBadge />}</>}
        meta={<>
          <a href={monitor.url} target="_blank" rel="noreferrer noopener" className="inline-flex max-w-full items-center gap-1 truncate font-mono text-xs hover:text-text">{monitor.method} {monitor.url}<ExternalLink className="size-3 shrink-0" /></a>
          <span>Every {formatInterval(monitor.intervalSeconds)}</span>
          {monitor.lastStatusChangeAt && <span>{MONITOR_STATUS_PHRASE[monitor.status]} for <Duration from={monitor.lastStatusChangeAt} /></span>}
        </>}
        actions={canWrite && <>
          <Button onClick={() => actions.checkNow.mutate(monitor)} disabled={!monitor.enabled} loading={actions.checkNow.isPending}><Zap />Check now</Button>
          <Button onClick={() => actions.toggle.mutate(monitor)} loading={actions.toggle.isPending}>{monitor.enabled ? <><Pause />Pause</> : <><Play />Resume</>}</Button>
          <Button asChild><Link href={org.paths.editMonitor(monitor.id)}><Pencil />Edit</Link></Button>
          {org.can("monitor:delete") && <Button variant="danger-ghost" size="icon" aria-label="Delete monitor" onClick={() => setConfirmDelete(true)}><Trash2 /></Button>}
        </>}
      />

      {monitor.status === "DOWN" && monitor.lastErrorMessage && (
        <div role="alert" className="mb-4 flex items-start gap-3 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm">
          <Siren className="mt-0.5 size-4 shrink-0 text-danger-fg" />
          <div><p className="font-medium text-text">This monitor is down. {monitor.consecutiveFailures} checks have failed in a row.</p><p className="text-text-2">{monitor.lastErrorMessage}</p></div>
        </div>
      )}

      <Tabs defaultValue="overview">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <TabsList className="flex-1"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="checks">Checks</TabsTrigger><TabsTrigger value="incidents">Incidents{incidents.data ? <Badge>{incidents.data.total}</Badge> : null}</TabsTrigger><TabsTrigger value="config">Configuration</TabsTrigger></TabsList>
        </div>

        <TabsContent value="overview" className="flex flex-col gap-4">
          <div className="flex justify-end"><RangePicker value={range} onChange={setRange} /></div>
          <section aria-label="Key metrics" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {!stats ? [0, 1, 2, 3].map((tile) => <Skeleton key={tile} className="h-[102px] rounded-xl" />) : <>
              <StatTile label="Uptime" value={formatUptime(stats.uptime)} hint={`${formatNumber(stats.failedChecks)} of ${formatNumber(stats.totalChecks)} checks failed`} />
              <StatTile label="Avg response time" value={formatMs(stats.avgResponseMs)} hint={`p95 ${formatMs(stats.p95ResponseMs)} · p99 ${formatMs(stats.p99ResponseMs)}`} />
              <StatTile label="Estimated downtime" value={formatDuration(stats.estimatedDowntimeSeconds)} hint="Failed checks × interval" />
              <StatTile label="Last check" value={formatMs(monitor.lastResponseTimeMs)} hint={monitor.lastStatusCode ? `HTTP ${monitor.lastStatusCode}` : (monitor.lastErrorMessage ?? "No checks yet")} />
            </>}
          </section>

          <Card>
            <CardHeader>
              <div><CardTitle>Availability, last 90 days</CardTitle><p className="mt-0.5 text-xs text-muted">One bar per UTC day. Grey means no checks ran.</p></div>
              <span className="font-display text-lg font-semibold">{formatUptime(uptimePercent(ninety))}</span>
            </CardHeader>
            <CardContent>
              {statsQuery.isPending ? <Skeleton className="h-8" /> : <UptimeBars days={availability} />}
              <div className="mt-2 flex justify-between text-2xs text-muted"><span>90 days ago</span><span>Today</span></div>
            </CardContent>
          </Card>

          <ChartCard title="Response time" description={`Average and 95th percentile, ${label}`} loading={!stats} refreshing={statsQuery.isPlaceholderData} empty={stats?.totalChecks === 0} height={260}
            legend={[{ label: "Average", color: "var(--chart-1)" }, { label: "p95", color: "var(--chart-2)" }]}
            table={stats && time ? { columns: ["Time", "Average", "p95", "Checks", "Failed"], rows: stats.series.map((point) => [time.tooltip(point.t), formatMs(point.avgMs), formatMs(point.p95Ms), point.total, point.down]) } : undefined}>
            {stats && <TimeSeriesChart data={stats.series.map((point) => ({ t: point.t, avg: point.avgMs, p95: point.p95Ms }))} series={[{ key: "avg", label: "Average", color: "var(--chart-1)" }, { key: "p95", label: "p95", color: "var(--chart-2)" }]} unit="ms" bucketSeconds={stats.bucketSeconds} utcDays={utc} />}
          </ChartCard>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader><div><CardTitle>Outages</CardTitle><p className="mt-0.5 text-xs text-muted">Runs of consecutive failed checks, {label}</p></div></CardHeader>
              {!stats ? <CardContent><Skeleton className="h-32" /></CardContent> : stats.source === "daily" ? (
                <p className="px-5 pb-5 text-sm text-muted">Individual outages are available for the 24-hour and 7-day windows. Longer windows are computed from daily rollups.</p>
              ) : stats.outages.length === 0 ? (
                <p className="px-5 pb-5 text-sm text-muted">No outages in this window.</p>
              ) : (
                <ul className="pb-2">
                  {stats.outages.map((outage) => (
                    <li key={outage.startedAt} className="flex items-center justify-between gap-3 px-5 py-2 text-sm">
                      <span className="min-w-0"><span className="block text-text">{formatDateTime(outage.startedAt)}</span><span className="block truncate text-xs text-muted">{outage.errorMessage ?? ERROR_LABELS[outage.errorType ?? "UNKNOWN"]}</span></span>
                      <span className="shrink-0 text-right"><span className="block font-medium tabular">{outage.endedAt ? formatDuration(outage.durationSeconds) : "Ongoing"}</span><span className="block text-xs text-muted">{outage.failedChecks} failed checks</span></span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <CardHeader><div><CardTitle>Failure causes</CardTitle><p className="mt-0.5 text-xs text-muted">Failed checks by error type, {label}</p></div></CardHeader>
              <CardContent>
                {!stats ? <Skeleton className="h-32" /> : stats.errorBreakdown.length === 0 ? <p className="text-sm text-muted">{stats.source === "daily" ? "Error types are available for the 24-hour and 7-day windows." : "No failed checks in this window."}</p>
                  : <RankedBars color="var(--danger)" rows={stats.errorBreakdown.map((row) => ({ key: row.errorType, label: ERROR_LABELS[row.errorType] ?? row.errorType, value: row.count, display: formatNumber(row.count) }))} />}
              </CardContent>
            </Card>
          </div>

          {stats && stats.source === "raw" && (
            <div className="grid gap-4 xl:grid-cols-2">
              <Card>
                <CardHeader><div><CardTitle>Failure pattern</CardTitle><p className="mt-0.5 text-xs text-muted">Failed checks by weekday and hour (UTC), {label}</p></div></CardHeader>
                <CardContent><FailureHeatmap cells={stats.failureHeatmap} /></CardContent>
              </Card>
              <Card>
                <CardHeader><div><CardTitle>Connection timing</CardTitle><p className="mt-0.5 text-xs text-muted">Mean time per phase across successful checks, {label}</p></div></CardHeader>
                <CardContent>
                  {stats.timing ? <RankedBars rows={[
                    { key: "dns", label: "DNS lookup", value: stats.timing.dnsMs ?? 0, display: formatMs(stats.timing.dnsMs) },
                    { key: "connect", label: "TCP connect", value: stats.timing.connectMs ?? 0, display: formatMs(stats.timing.connectMs) },
                    ...(stats.timing.tlsMs !== null ? [{ key: "tls", label: "TLS handshake", value: stats.timing.tlsMs, display: formatMs(stats.timing.tlsMs) }] : []),
                    { key: "ttfb", label: "Waiting for first byte", value: stats.timing.ttfbMs ?? 0, display: formatMs(stats.timing.ttfbMs) },
                  ]} /> : <p className="text-sm text-muted">No successful checks with timing data in this window.</p>}
                </CardContent>
              </Card>
            </div>
          )}
          {stats && <OriginNote origin={stats.origin} />}
        </TabsContent>

        <TabsContent value="checks"><Card className="overflow-hidden"><ChecksTable monitorId={monitor.id} /></Card></TabsContent>

        <TabsContent value="incidents">
          <Card className="overflow-hidden">
            {incidents.isPending ? <div className="p-5"><Skeleton className="h-24" /></div> : incidents.isError ? <ErrorState onRetry={() => incidents.refetch()} /> : incidents.data.items.length === 0 ? (
              <EmptyState icon={Siren} title="No incidents" description="This monitor has not been part of an incident." />
            ) : (
              <ul>
                {incidents.data.items.map((incident) => (
                  <li key={incident.id} className="border-b border-border last:border-b-0">
                    <Link href={org.paths.incident(incident.id)} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-2">
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-sm text-text"><span className="font-mono text-xs text-muted">INC-{incident.number}</span><span className="truncate">{incident.title}</span></span>
                        <span className="text-xs text-muted"><RelativeTime date={incident.startedAt} /> · {incident.resolvedAt ? "lasted " : "open for "}<Duration from={incident.startedAt} to={incident.resolvedAt} /></span>
                      </span>
                      <SeverityBadge severity={incident.severity} className="hidden sm:inline-flex" /><IncidentStatusBadge status={incident.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="config">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card><CardHeader><CardTitle>Check</CardTitle></CardHeader><CardContent><dl>
              <ConfigRow label="URL"><span className="font-mono text-xs">{monitor.url}</span></ConfigRow>
              <ConfigRow label="Method">{monitor.method}</ConfigRow>
              <ConfigRow label="Type">{monitor.kind === "API" ? "API endpoint" : "Website"}</ConfigRow>
              <ConfigRow label="Category">{monitor.category ?? "—"}</ConfigRow>
              <ConfigRow label="Interval">{formatInterval(monitor.intervalSeconds)}</ConfigRow>
              <ConfigRow label="Timeout">{formatMs(monitor.timeoutMs)}</ConfigRow>
              <ConfigRow label="Expected status"><span className="font-mono text-xs">{monitor.expectedStatusCodes}</span></ConfigRow>
              <ConfigRow label="Follow redirects">{monitor.followRedirects ? "Yes" : "No"}</ConfigRow>
              <ConfigRow label="Retries per check">{monitor.retries}</ConfigRow>
            </dl></CardContent></Card>
            <Card><CardHeader><CardTitle>Outage policy and state</CardTitle></CardHeader><CardContent><dl>
              <ConfigRow label="Failures before down">{monitor.failureThreshold}</ConfigRow>
              <ConfigRow label="Successes to recover">{monitor.recoveryThreshold}</ConfigRow>
              <ConfigRow label="Degraded above">{monitor.degradedThresholdMs === null ? "Disabled" : formatMs(monitor.degradedThresholdMs)}</ConfigRow>
              <ConfigRow label="Automatic incidents">{monitor.autoIncident ? `Yes, ${monitor.incidentSeverity.toLowerCase()} severity` : "No"}</ConfigRow>
              <ConfigRow label="Last successful check"><RelativeTime date={monitor.lastSuccessAt} /></ConfigRow>
              <ConfigRow label="Last failed check"><RelativeTime date={monitor.lastFailureAt} /></ConfigRow>
              <ConfigRow label="Last error">{monitor.lastErrorMessage ?? "None"}</ConfigRow>
              <ConfigRow label="Next check">{monitor.enabled ? <RelativeTime date={monitor.nextCheckAt} /> : "Paused"}</ConfigRow>
              <ConfigRow label="Created"><RelativeTime date={monitor.createdAt} /></ConfigRow>
            </dl></CardContent></Card>
          </div>
        </TabsContent>
      </Tabs>

      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} destructive title={`Delete ${monitor.name}?`} confirmLabel="Delete monitor" loading={actions.remove.isPending}
        description="Its check history and daily statistics are deleted with it, and it is removed from any status page. Incidents that referenced it are kept. This cannot be undone."
        onConfirm={() => actions.remove.mutate(monitor, { onSuccess: () => router.push(org.paths.monitors) })} />
    </PageContainer>
  );
}

const MONITOR_STATUS_PHRASE = { UP: "Operational", DEGRADED: "Degraded", DOWN: "Down", PAUSED: "Paused", PENDING: "Pending" } as const;
