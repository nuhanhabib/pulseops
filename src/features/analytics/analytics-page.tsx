"use client";

import Link from "next/link";
import { useState } from "react";

import { ChartCard } from "@/components/charts/chart-card";
import { RankedBars, StatTile, UptimeBars } from "@/components/charts/figures";
import { BarSeriesChart, TimeSeriesChart, timeFormatters } from "@/components/charts/time-series";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { MonitorStatusBadge, SEVERITY } from "@/components/ui/status";
import { Table, TableContainer, Td, Th, Tr } from "@/components/ui/table";
import { useOrg } from "@/features/org/org-context";
import { OriginNote, percentDelta, pointsDelta, RangePicker, useOrgQuery } from "@/features/shared";
import { cn } from "@/lib/cn";
import { TIME_RANGES, type TimeRange } from "@/shared/constants";
import { formatDuration, formatMs, formatNumber, formatUtcDay } from "@/shared/format";
import type { AnalyticsDto } from "@/shared/types";
import { formatUptime } from "@/shared/uptime";

export function AnalyticsPage() {
  const org = useOrg();
  const [range, setRange] = useState<TimeRange>("30d");
  const query = useOrgQuery<AnalyticsDto>(["analytics"], "/analytics", { range });
  const data = query.data;
  const label = TIME_RANGES[range].label.toLowerCase();
  const short = TIME_RANGES[range].short;
  const utc = TIME_RANGES[range].source === "daily";
  const time = data ? timeFormatters(data.bucketSeconds, utc) : null;
  const frequencyTime = data ? timeFormatters(data.incidents.frequencyBucketSeconds, false) : null;

  if (query.isError && !data) return <PageContainer><PageHeader title="Analytics" /><Card><ErrorState onRetry={() => query.refetch()} /></Card></PageContainer>;

  // Worst first: lowest uptime, then slowest.
  const ranked = data ? [...data.monitors].filter((monitor) => monitor.totalChecks > 0).sort((a, b) => (a.uptime ?? 100) - (b.uptime ?? 100) || (b.avgResponseMs ?? 0) - (a.avgResponseMs ?? 0)) : [];
  const slowest = data ? [...data.monitors].filter((monitor) => monitor.p95ResponseMs !== null).sort((a, b) => (b.p95ResponseMs ?? 0) - (a.p95ResponseMs ?? 0)).slice(0, 6) : [];
  const hasDistribution = data ? data.responseDistribution.some((bucket) => bucket.count > 0) : false;

  return (
    <PageContainer>
      <PageHeader title="Analytics" description="Reliability and incident trends. Every figure is defined in the metrics documentation." actions={<RangePicker value={range} onChange={setRange} />} />
      <div className={cn("flex flex-col gap-4 transition-opacity", query.isPlaceholderData && "opacity-70")} aria-busy={query.isPending || query.isPlaceholderData}>
        <section aria-label="Key metrics" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {!data ? [0, 1, 2, 3].map((tile) => <Skeleton key={tile} className="h-[102px] rounded-xl" />) : <>
            <StatTile label="Uptime" value={formatUptime(data.uptime.value, 3)} delta={pointsDelta(data.uptime)} hint={`vs previous ${short}`} />
            <StatTile label="Avg response time" value={formatMs(data.avgResponseMs.value)} delta={percentDelta(data.avgResponseMs, false)} hint={`p95 ${formatMs(data.p95ResponseMs)}`} />
            <StatTile label="Incidents opened" value={formatNumber(data.incidents.total.value)} delta={percentDelta(data.incidents.total, false)} hint={`${data.incidents.resolved} resolved`} />
            <StatTile label="Mean time to resolve" value={formatDuration(data.incidents.mttrSeconds.value)} delta={percentDelta(data.incidents.mttrSeconds, false)} hint={`vs previous ${short}`} />
          </>}
        </section>

        <div className="grid gap-4 xl:grid-cols-2">
          <ChartCard title="Uptime trend" description={`Share of checks that succeeded, ${label}`} loading={!data} empty={data?.totalChecks === 0}
            table={data && time ? { columns: ["Period", "Uptime", "Checks", "Failed"], rows: data.series.map((point) => [time.tooltip(point.t), formatUptime(point.uptime, 3), point.total, point.down]) } : undefined}>
            {data && <TimeSeriesChart data={data.series.map((point) => ({ t: point.t, uptime: point.uptime }))} series={[{ key: "uptime", label: "Uptime", color: "var(--chart-3)" }]} unit="percent" bucketSeconds={data.bucketSeconds} utcDays={utc} domain={[(min: number) => Math.max(0, Math.floor(Math.min(min, 99.5) - 0.5)), 100]} />}
          </ChartCard>
          <ChartCard title="Response time trend" description={`Average and 95th percentile, ${label}`} loading={!data} empty={data?.totalChecks === 0}
            legend={[{ label: "Average", color: "var(--chart-1)" }, { label: "p95", color: "var(--chart-2)" }]}
            table={data && time ? { columns: ["Period", "Average", "p95"], rows: data.series.map((point) => [time.tooltip(point.t), formatMs(point.avgMs), formatMs(point.p95Ms)]) } : undefined}>
            {data && <TimeSeriesChart data={data.series.map((point) => ({ t: point.t, avg: point.avgMs, p95: point.p95Ms }))} series={[{ key: "avg", label: "Average", color: "var(--chart-1)" }, { key: "p95", label: "p95", color: "var(--chart-2)" }]} unit="ms" bucketSeconds={data.bucketSeconds} utcDays={utc} />}
          </ChartCard>
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          <ChartCard className="xl:col-span-2" title="Incident frequency" description={`Incidents opened per ${data?.incidents.frequencyBucketSeconds === 3600 ? "hour" : "day"}, by severity, ${label}`} loading={!data} empty={data?.incidents.total.value === 0} emptyMessage="No incidents were opened in this window."
            legend={[{ label: "Critical", color: "var(--chart-8)", shape: "rect" }, { label: "High", color: "var(--chart-2)", shape: "rect" }, { label: "Medium", color: "var(--chart-4)", shape: "rect" }, { label: "Low", color: "var(--chart-7)", shape: "rect" }]}
            table={data && frequencyTime ? { columns: ["Period", "Critical", "High", "Medium", "Low"], rows: data.incidents.frequency.filter((row) => row.critical + row.high + row.medium + row.low > 0).map((row) => [frequencyTime.tooltip(row.t), row.critical, row.high, row.medium, row.low]) } : undefined}>
            {data && <BarSeriesChart stacked data={data.incidents.frequency} series={[{ key: "low", label: "Low", color: "var(--chart-7)" }, { key: "medium", label: "Medium", color: "var(--chart-4)" }, { key: "high", label: "High", color: "var(--chart-2)" }, { key: "critical", label: "Critical", color: "var(--chart-8)" }]} unit="count" bucketSeconds={data.incidents.frequencyBucketSeconds} />}
          </ChartCard>
          <Card>
            <CardHeader><div><CardTitle>Incidents by severity</CardTitle><p className="mt-0.5 text-xs text-muted">Opened {label}</p></div></CardHeader>
            <CardContent>
              {!data ? <Skeleton className="h-40" /> : <RankedBars rows={data.incidents.bySeverity.map((row) => ({ key: row.severity, label: SEVERITY[row.severity].label, value: row.count, display: formatNumber(row.count) }))} />}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <ChartCard title="Response time distribution" description={`Successful checks by response time, ${label}`} loading={!data} empty={!hasDistribution} emptyMessage="Distributions need individual checks, which are kept for the 24-hour and 7-day windows."
            table={data ? { columns: ["Response time", "Checks"], rows: data.responseDistribution.map((bucket) => [bucket.label, bucket.count]) } : undefined}>
            {data && <BarSeriesChart categorical data={data.responseDistribution.map((bucket) => ({ t: bucket.label, count: bucket.count }))} series={[{ key: "count", label: "Checks", color: "var(--chart-1)" }]} unit="count" bucketSeconds={0} />}
          </ChartCard>
          <Card>
            <CardHeader><div><CardTitle>Slowest endpoints</CardTitle><p className="mt-0.5 text-xs text-muted">By 95th percentile response time, {label}</p></div></CardHeader>
            <CardContent>{!data ? <Skeleton className="h-48" /> : slowest.length === 0 ? <p className="text-sm text-muted">No response data in this window.</p> : <RankedBars rows={slowest.map((monitor) => ({ key: monitor.id, label: monitor.name, value: monitor.p95ResponseMs ?? 0, display: formatMs(monitor.p95ResponseMs), hint: `avg ${formatMs(monitor.avgResponseMs)}` }))} />}</CardContent>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader><div><CardTitle>Daily availability</CardTitle><p className="mt-0.5 text-xs text-muted">All monitors combined, one bar per UTC day</p></div></CardHeader>
            <CardContent>{!data ? <Skeleton className="h-8" /> : <><UptimeBars days={data.daily} /><div className="mt-2 flex justify-between text-2xs text-muted"><span>{data.daily[0] ? formatUtcDay(`${data.daily[0].date}T00:00:00Z`) : ""}</span><span>Today</span></div></>}</CardContent>
          </Card>
          <Card>
            <CardHeader><div><CardTitle>Weekly availability</CardTitle><p className="mt-0.5 text-xs text-muted">Weeks start Monday, UTC</p></div></CardHeader>
            <CardContent>
              {!data ? <Skeleton className="h-32" /> : (
                <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
                  {[...data.weekly].reverse().map((week) => (
                    <li key={week.weekStart} className="flex items-center justify-between text-sm"><span className="text-text-2">Week of {formatUtcDay(`${week.weekStart}T00:00:00Z`)}</span><span className="font-medium tabular">{formatUptime(week.uptime, 3)}</span></li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="overflow-hidden">
          <CardHeader><div><CardTitle>Monitor reliability</CardTitle><p className="mt-0.5 text-xs text-muted">Worst-performing first, {label}</p></div></CardHeader>
          {!data ? <CardContent><Skeleton className="h-48" /></CardContent> : ranked.length === 0 ? <p className="px-5 pb-5 text-sm text-muted">No checks in this window.</p> : (
            <TableContainer>
              <Table>
                <thead><tr><Th>Monitor</Th><Th>Now</Th><Th className="text-right">Uptime</Th><Th className="hidden text-right sm:table-cell">Failed checks</Th><Th className="hidden text-right md:table-cell">Avg</Th><Th className="hidden text-right md:table-cell">p95</Th><Th className="text-right">Incidents</Th></tr></thead>
                <tbody>
                  {ranked.map((monitor) => (
                    <Tr key={monitor.id} interactive>
                      <Td className="h-11"><Link href={org.paths.monitor(monitor.id)} className="font-medium hover:underline">{monitor.name}</Link></Td>
                      <Td className="h-11"><MonitorStatusBadge status={monitor.status} /></Td>
                      <Td className="h-11 text-right font-medium tabular">{formatUptime(monitor.uptime, 3)}</Td>
                      <Td className="hidden h-11 text-right text-text-2 tabular sm:table-cell">{formatNumber(monitor.failedChecks)} / {formatNumber(monitor.totalChecks)}</Td>
                      <Td className="hidden h-11 text-right text-text-2 tabular md:table-cell">{formatMs(monitor.avgResponseMs)}</Td>
                      <Td className="hidden h-11 text-right text-text-2 tabular md:table-cell">{formatMs(monitor.p95ResponseMs)}</Td>
                      <Td className="h-11 text-right tabular">{monitor.incidents}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableContainer>
          )}
        </Card>
        {data && <OriginNote origin={data.origin} />}
      </div>
    </PageContainer>
  );
}
