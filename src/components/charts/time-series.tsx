"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { formatDateTime, formatDay, formatMs, formatTime, formatUtcDay } from "@/shared/format";

export interface SeriesDef {
  key: string;
  label: string;
  /** CSS colour token, e.g. "var(--chart-1)". */
  color: string;
}

export type Unit = "ms" | "percent" | "count";

const formatters: Record<Unit, (value: number) => string> = {
  ms: (value) => formatMs(value),
  percent: (value) => `${value >= 99.995 ? "100" : value.toFixed(2)}%`,
  count: (value) => value.toLocaleString("en-US"),
};

const axisFormatters: Record<Unit, (value: number) => string> = {
  ms: (value) => (value >= 1000 ? `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}s` : `${value}ms`),
  percent: (value) => `${Number(value.toFixed(2))}%`,
  count: (value) => (value >= 10_000 ? `${Math.round(value / 1000)}K` : value.toLocaleString("en-US")),
};

/** Tick and tooltip labels follow the bucket size: clock times within a day, dates beyond. */
export function timeFormatters(bucketSeconds: number, utcDays = false) {
  if (bucketSeconds >= 86_400) {
    const day = utcDays ? formatUtcDay : formatDay;
    return { tick: (value: string) => day(value), tooltip: (value: string) => day(value) };
  }
  if (bucketSeconds >= 3 * 3600) return { tick: (value: string) => formatDay(value), tooltip: (value: string) => formatDateTime(value) };
  return { tick: (value: string) => formatTime(value), tooltip: (value: string) => formatDateTime(value) };
}

interface TooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: readonly { dataKey?: unknown; value?: unknown; payload?: Record<string, unknown> }[];
}

/** Values lead, labels follow; one row per series, keyed with a stroke of its colour. */
function ChartTooltip({ active, payload, label, series, unit, formatLabel }: TooltipProps & { series: SeriesDef[]; unit: Unit; formatLabel: (value: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-36 rounded-lg border border-border bg-overlay px-3 py-2 shadow-lg">
      <p className="mb-1.5 text-2xs text-muted">{formatLabel(String(label))}</p>
      <ul className="flex flex-col gap-1">
        {series.map((item) => {
          const entry = payload.find((row) => row.dataKey === item.key);
          const value = typeof entry?.value === "number" ? entry.value : null;
          return (
            <li key={item.key} className="flex items-center justify-between gap-4 text-xs">
              <span className="flex items-center gap-1.5 text-text-2">
                <span aria-hidden className="h-0.5 w-2.5 rounded-full" style={{ background: item.color }} />
                {item.label}
              </span>
              <span className="font-medium text-text tabular">{value === null ? "—" : formatters[unit](value)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const axisTick = { fill: "var(--muted)", fontSize: 11 };

interface TimeSeriesProps {
  data: Record<string, string | number | null>[];
  series: SeriesDef[];
  unit: Unit;
  bucketSeconds: number;
  utcDays?: boolean;
  /** Fix the y-domain, e.g. uptime charts that should not start at zero. */
  domain?: [number | "auto" | "dataMin" | ((dataMin: number) => number), number | "auto" | "dataMax"];
}

/** Line chart with a soft area wash and a crosshair that snaps to the nearest bucket. */
export function TimeSeriesChart({ data, series, unit, bucketSeconds, utcDays, domain }: TimeSeriesProps) {
  const time = timeFormatters(bucketSeconds, utcDays);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="t" tickFormatter={time.tick} tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--chart-axis)" }} minTickGap={48} tickMargin={8} />
        <YAxis tickFormatter={axisFormatters[unit]} tick={axisTick} tickLine={false} axisLine={false} width={48} domain={domain} allowDecimals={unit === "percent"} />
        <Tooltip
          cursor={{ stroke: "var(--chart-axis)", strokeWidth: 1 }}
          content={(props) => <ChartTooltip {...(props as TooltipProps)} series={series} unit={unit} formatLabel={time.tooltip} />}
        />
        {series.map((item, index) => (
          <Area
            key={item.key}
            type="monotone"
            dataKey={item.key}
            name={item.label}
            stroke={item.color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            // Only the first series carries the wash; overlapping fills turn to mud.
            fill={item.color}
            fillOpacity={index === 0 ? 0.1 : 0}
            dot={false}
            activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }}
            connectNulls={false}
            animationDuration={400}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

interface BarSeriesProps extends Omit<TimeSeriesProps, "domain"> {
  stacked?: boolean;
  /** Category axis instead of a time axis. */
  categorical?: boolean;
}

/** Thin columns: capped width, rounded data end, a surface-coloured gap between stacked segments. */
export function BarSeriesChart({ data, series, unit, bucketSeconds, utcDays, stacked, categorical }: BarSeriesProps) {
  const time = categorical ? { tick: (value: string) => value, tooltip: (value: string) => value } : timeFormatters(bucketSeconds, utcDays);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }} barCategoryGap="22%">
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="t" tickFormatter={time.tick} tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--chart-axis)" }} minTickGap={categorical ? 4 : 40} tickMargin={8} interval={categorical ? 0 : "preserveStartEnd"} />
        <YAxis tickFormatter={axisFormatters[unit]} tick={axisTick} tickLine={false} axisLine={false} width={48} allowDecimals={false} />
        <Tooltip
          cursor={{ fill: "var(--surface-3)", opacity: 0.5 }}
          content={(props) => <ChartTooltip {...(props as TooltipProps)} series={series} unit={unit} formatLabel={time.tooltip} />}
        />
        {series.map((item, index) => (
          <Bar
            key={item.key}
            dataKey={item.key}
            name={item.label}
            stackId={stacked ? "stack" : undefined}
            fill={item.color}
            maxBarSize={24}
            stroke={stacked ? "var(--surface)" : undefined}
            strokeWidth={stacked ? 1 : 0}
            radius={!stacked || index === series.length - 1 ? [4, 4, 0, 0] : 0}
            animationDuration={400}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
