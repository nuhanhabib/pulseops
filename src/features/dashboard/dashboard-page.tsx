"use client";

import { Activity, AlertTriangle, CheckCircle2, Clock, Gauge, PauseCircle, Plus, Siren, Timer, XCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ChartCard } from "@/components/charts/chart-card";
import { SegmentedBar, StatTile } from "@/components/charts/figures";
import { BarSeriesChart, TimeSeriesChart, timeFormatters } from "@/components/charts/time-series";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { Duration, RelativeTime } from "@/components/ui/relative-time";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { IncidentStatusBadge, SampleBadge, SeverityBadge } from "@/components/ui/status";
import { useOrg } from "@/features/org/org-context";
import { OriginNote, percentDelta, pointsDelta, RangePicker, useOrgQuery } from "@/features/shared";
import { cn } from "@/lib/cn";
import { DEFAULT_TIME_RANGE, TIME_RANGES, type TimeRange } from "@/shared/constants";
import { formatDuration, formatMs, formatNumber } from "@/shared/format";
import type { ActivityInboxDto, DashboardDto, IncidentListItemDto, Paginated } from "@/shared/types";
import { formatUptime } from "@/shared/uptime";

const LEVEL = {
  CRITICAL: { icon: XCircle, className: "text-danger-fg" }, WARNING: { icon: AlertTriangle, className: "text-warn-fg" },
  SUCCESS: { icon: CheckCircle2, className: "text-ok-fg" }, INFO: { icon: Activity, className: "text-info-fg" },
} as const;

function RecentEvents() {
  const org = useOrg();
  const events = useOrgQuery<ActivityInboxDto>(["activity", "recent"], "/activity", { limit: 8 });
  return (
    <Card className="flex flex-col">
      <CardHeader><CardTitle>Recent events</CardTitle></CardHeader>
      {events.isPending ? (
        <CardContent className="flex flex-col gap-3">{[0, 1, 2, 3, 4].map((row) => <Skeleton key={row} className="h-8" />)}</CardContent>
      ) : events.isError ? (
        <ErrorState className="py-8" onRetry={() => events.refetch()} />
      ) : events.data.items.length === 0 ? (
        <EmptyState icon={Activity} title="No events yet" description="State changes for your monitors will be listed here." className="py-8" />
      ) : (
        <ul className="pb-2">
          {events.data.items.map((event) => {
            const level = LEVEL[event.level];
            const href = event.incidentId ? org.paths.incident(event.incidentId) : event.monitorId ? org.paths.monitor(event.monitorId) : org.paths.monitors;
            return (
              <li key={event.id}>
                <Link href={href} className="flex items-start gap-3 px-5 py-2 transition-colors hover:bg-surface-2">
                  <level.icon className={cn("mt-0.5 size-4 shrink-0", level.className)} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm text-text"><span className="truncate">{event.title}</span>{event.isSample && <SampleBadge />}</span>
                    {event.description && <span className="block truncate text-xs text-muted">{event.description}</span>}
                  </span>
                  <RelativeTime date={event.occurredAt} className="shrink-0 text-xs text-muted" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function RecentIncidents() {
  const org = useOrg();
  const incidents = useOrgQuery<Paginated<IncidentListItemDto>>(["incidents", "recent"], "/incidents", { pageSize: 6, sort: "startedAt" });
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle>Incident activity</CardTitle>
        <Button asChild variant="ghost" size="sm"><Link href={org.paths.incidents}>View all</Link></Button>
      </CardHeader>
      {incidents.isPending ? (
        <CardContent className="flex flex-col gap-3">{[0, 1, 2, 3].map((row) => <Skeleton key={row} className="h-10" />)}</CardContent>
      ) : incidents.isError ? (
        <ErrorState className="py-8" onRetry={() => incidents.refetch()} />
      ) : incidents.data.items.length === 0 ? (
        <EmptyState icon={Siren} title="No incidents" description="Incidents open automatically when a monitor stays down, or you can declare one." className="py-8" />
      ) : (
        <ul className="pb-2">
          {incidents.data.items.map((incident) => (
            <li key={incident.id}>
              <Link href={org.paths.incident(incident.id)} className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-surface-2">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm text-text">
                    <span className="shrink-0 font-mono text-xs text-muted">INC-{incident.number}</span>
                    <span className="truncate">{incident.title}</span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                    <RelativeTime date={incident.startedAt} />·
                    <span>{incident.resolvedAt ? "lasted " : "open for "}<Duration from={incident.startedAt} to={incident.resolvedAt} /></span>
                  </span>
                </span>
                <SeverityBadge severity={incident.severity} className="hidden sm:inline-flex" />
                <IncidentStatusBadge status={incident.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function DashboardPage() {
  const org = useOrg();
  const [range, setRange] = useState<TimeRange>(DEFAULT_TIME_RANGE);
  const dashboard = useOrgQuery<DashboardDto>(["dashboard"], "/dashboard", { range });
  const data = dashboard.data;
  const refreshing = dashboard.isPlaceholderData;
  const label = TIME_RANGES[range].label.toLowerCase();
  const utc = TIME_RANGES[range].source === "daily";
  const time = data ? timeFormatters(data.bucketSeconds, utc) : null;

  if (dashboard.isError && !data) {
    return <PageContainer><PageHeader title="Dashboard" /><Card><ErrorState onRetry={() => dashboard.refetch()} /></Card></PageContainer>;
  }

  const noMonitors = data && data.monitors.total === 0;

  return (
    <PageContainer>
      <PageHeader
        title="Dashboard"
        description={`Health of ${org.organization.name} across every monitor.`}
        actions={<><RangePicker value={range} onChange={setRange} />{org.can("monitor:write") && <Button asChild variant="primary"><Link href={org.paths.newMonitor}><Plus />New monitor</Link></Button>}</>}
      />

      {noMonitors ? (
        <Card><EmptyState icon={Activity} title="Add your first monitor" description="Point PulseOps at a website or API endpoint and it will start checking within seconds." action={org.can("monitor:write") ? <Button asChild variant="primary"><Link href={org.paths.newMonitor}><Plus />New monitor</Link></Button> : undefined} /></Card>
      ) : (
        <div className={cn("flex flex-col gap-4 transition-opacity", refreshing && "opacity-70")} aria-busy={dashboard.isPending || refreshing}>
          <section aria-label="Key metrics" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {!data ? Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-[102px] rounded-xl" />) : (
              <>
                <StatTile label="Uptime" value={formatUptime(data.uptime.value)} delta={pointsDelta(data.uptime)} hint={`vs previous ${TIME_RANGES[range].short}`} icon={<Gauge />} />
                <StatTile label="Avg response time" value={formatMs(data.avgResponseMs.value)} delta={percentDelta(data.avgResponseMs, false)} hint={`p95 ${formatMs(data.p95ResponseMs)}`} icon={<Timer />} />
                <StatTile label="Active incidents" value={formatNumber(data.incidents.active)} hint={data.incidents.active === 0 ? "All clear" : "Need attention"} icon={<Siren />} />
                <StatTile label="Incidents resolved" value={formatNumber(data.incidents.resolved)} hint={data.incidents.mttrSeconds === null ? label : `MTTR ${formatDuration(data.incidents.mttrSeconds)}`} icon={<CheckCircle2 />} />
                <StatTile label="Total monitors" value={formatNumber(data.monitors.total)} hint={`${formatNumber(data.checks.total)} checks, ${label}`} icon={<Activity />} />
                <StatTile label="Operational" value={formatNumber(data.monitors.up)} hint={`of ${data.monitors.total - data.monitors.paused} active`} icon={<CheckCircle2 />} />
                <StatTile label="Degraded" value={formatNumber(data.monitors.degraded)} hint="Slow or partly failing" icon={<AlertTriangle />} />
                <StatTile label="Down" value={formatNumber(data.monitors.down)} hint={data.monitors.paused ? `${data.monitors.paused} paused` : "Confirmed outages"} icon={<XCircle />} />
              </>
            )}
          </section>

          <div className="grid gap-4 xl:grid-cols-3">
            <ChartCard
              className="xl:col-span-2" title="Response time" description={`Average and 95th percentile across all monitors, ${label}`}
              loading={!data} empty={data?.checks.total === 0}
              legend={[{ label: "Average", color: "var(--chart-1)" }, { label: "p95", color: "var(--chart-2)" }]}
              table={data && time ? { columns: ["Time", "Average", "p95"], rows: data.series.map((point) => [time.tooltip(point.t), formatMs(point.avgMs), formatMs(point.p95Ms)]) } : undefined}
            >
              {data && <TimeSeriesChart data={data.series.map((point) => ({ t: point.t, avg: point.avgMs, p95: point.p95Ms }))} series={[{ key: "avg", label: "Average", color: "var(--chart-1)" }, { key: "p95", label: "p95", color: "var(--chart-2)" }]} unit="ms" bucketSeconds={data.bucketSeconds} utcDays={utc} />}
            </ChartCard>

            <Card>
              <CardHeader><div><CardTitle>Service health</CardTitle><p className="mt-0.5 text-xs text-muted">Monitors by current status</p></div></CardHeader>
              <CardContent>
                {!data ? <Skeleton className="h-40" /> : (
                  <SegmentedBar segments={[
                    { label: "Operational", value: data.monitors.up, color: "var(--ok)", icon: <CheckCircle2 className="size-3.5 text-ok-fg" /> },
                    { label: "Degraded", value: data.monitors.degraded, color: "var(--warn)", icon: <AlertTriangle className="size-3.5 text-warn-fg" /> },
                    { label: "Down", value: data.monitors.down, color: "var(--danger)", icon: <XCircle className="size-3.5 text-danger-fg" /> },
                    { label: "Paused", value: data.monitors.paused, color: "var(--neutral)", icon: <PauseCircle className="size-3.5 text-muted" /> },
                    { label: "Pending first check", value: data.monitors.pending, color: "var(--info)", icon: <Clock className="size-3.5 text-info-fg" /> },
                  ]} />
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <ChartCard
              title="Availability" description={`Share of checks that succeeded, ${label}`} loading={!data} empty={data?.checks.total === 0} height={200}
              table={data && time ? { columns: ["Time", "Uptime", "Checks"], rows: data.series.map((point) => [time.tooltip(point.t), formatUptime(point.uptime), point.total]) } : undefined}
            >
              {data && <TimeSeriesChart data={data.series.map((point) => ({ t: point.t, uptime: point.uptime }))} series={[{ key: "uptime", label: "Uptime", color: "var(--chart-3)" }]} unit="percent" bucketSeconds={data.bucketSeconds} utcDays={utc} domain={[(min: number) => Math.max(0, Math.floor(Math.min(min, 99) - 0.5)), 100]} />}
            </ChartCard>
            <ChartCard
              title="Failed and slow checks" description={`Checks that failed or exceeded their latency threshold, ${label}`} loading={!data} empty={data?.checks.total === 0} height={200}
              legend={[{ label: "Slow", color: "var(--warn)", shape: "rect" }, { label: "Failed", color: "var(--danger)", shape: "rect" }]}
              table={data && time ? { columns: ["Time", "Slow", "Failed", "All checks"], rows: data.series.map((point) => [time.tooltip(point.t), point.degraded, point.down, point.total]) } : undefined}
            >
              {data && <BarSeriesChart stacked data={data.series.map((point) => ({ t: point.t, degraded: point.degraded, down: point.down }))} series={[{ key: "degraded", label: "Slow", color: "var(--warn)" }, { key: "down", label: "Failed", color: "var(--danger)" }]} unit="count" bucketSeconds={data.bucketSeconds} utcDays={utc} />}
            </ChartCard>
          </div>

          <div className="grid gap-4 xl:grid-cols-2"><RecentEvents /><RecentIncidents /></div>
          {data && <OriginNote origin={data.origin} />}
        </div>
      )}
    </PageContainer>
  );
}
