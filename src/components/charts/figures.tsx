"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { formatUtcDay } from "@/shared/format";
import { formatUptime } from "@/shared/uptime";

// ── Stat tile ───────────────────────────────────────────────────────────────

interface StatTileProps {
  label: string;
  value: string;
  /** Signed change against the previous period, already formatted ("+0.12 pts"). */
  delta?: { text: string; direction: "up" | "down" | "flat"; good: boolean | null } | null;
  hint?: string;
  icon?: React.ReactNode;
  className?: string;
}

/** A headline number with an optional change against the preceding period. */
export function StatTile({ label, value, delta, hint, icon, className }: StatTileProps) {
  const Arrow = delta?.direction === "up" ? ArrowUpRight : delta?.direction === "down" ? ArrowDownRight : Minus;
  return (
    <div className={cn("surface-card flex min-w-0 flex-col gap-1 px-4 py-3.5", className)}>
      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span className="truncate">{label}</span>
        {icon && <span className="shrink-0 text-faint [&_svg]:size-3.5">{icon}</span>}
      </div>
      {/* Proportional figures: tabular digits look loose at this size. */}
      <div className="font-display text-2xl leading-8 font-semibold tracking-tight text-text">{value}</div>
      <div className="flex min-h-4 items-center gap-1.5 text-xs">
        {delta && (
          <span className={cn("inline-flex items-center gap-0.5 font-medium", delta.good === null ? "text-muted" : delta.good ? "text-ok-fg" : "text-danger-fg")}>
            <Arrow className="size-3" aria-hidden />
            {delta.text}
          </span>
        )}
        {hint && <span className="truncate text-muted">{hint}</span>}
      </div>
    </div>
  );
}

// ── Sparkline ───────────────────────────────────────────────────────────────

/** Trend at a glance for table rows. Gaps in the data stay gaps. */
export function Sparkline({ values, className, label }: { values: (number | null)[]; className?: string; label: string }) {
  const points = values.map((value, index) => ({ value, index })).filter((point): point is { value: number; index: number } => point.value !== null);
  if (points.length < 2) return <span className={cn("block h-6 w-24 text-center text-xs text-faint", className)}>—</span>;
  const width = 96, height = 24, pad = 2;
  const min = Math.min(...points.map((point) => point.value));
  const max = Math.max(...points.map((point) => point.value));
  const span = max - min || 1;
  const x = (index: number) => pad + (index / Math.max(1, values.length - 1)) * (width - pad * 2);
  const y = (value: number) => height - pad - ((value - min) / span) * (height - pad * 2);
  let path = "";
  let previous = -2;
  for (const point of points) {
    path += `${point.index === previous + 1 ? "L" : "M"}${x(point.index).toFixed(1)},${y(point.value).toFixed(1)} `;
    previous = point.index;
  }
  const last = points[points.length - 1]!;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={cn("h-6 w-24", className)} role="img" aria-label={label}>
      <path d={path} fill="none" stroke="var(--chart-1)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(last.index)} cy={y(last.value)} r="2" fill="var(--chart-1)" />
    </svg>
  );
}

// ── Uptime bars ─────────────────────────────────────────────────────────────

export function uptimeColor(uptime: number | null): string {
  if (uptime === null) return "var(--chart-muted)";
  if (uptime >= 99.7) return "var(--ok)";
  if (uptime >= 99) return "color-mix(in oklch, var(--ok) 55%, var(--warn))";
  if (uptime >= 95) return "var(--warn)";
  return "var(--danger)";
}

/**
 * One bar per day, coloured by that day's availability. Each bar is a focusable
 * element with the date and figure in its label, so the strip is not hover-only.
 */
export function UptimeBars({ days, className, height = 32 }: { days: { date: string; uptime: number | null }[]; className?: string; height?: number }) {
  return (
    <div className={cn("flex w-full items-stretch gap-[2px]", className)} style={{ height }} role="list" aria-label={`Daily availability for the last ${days.length} days`}>
      {days.map((day) => {
        const text = `${formatUtcDay(`${day.date}T00:00:00Z`)}: ${day.uptime === null ? "no data" : `${formatUptime(day.uptime)} uptime`}`;
        return (
          <Tooltip key={day.date} content={text}>
            <span role="listitem" tabIndex={0} aria-label={text} className="min-w-[2px] flex-1 rounded-[2px] opacity-90 transition-opacity hover:opacity-100 focus-visible:opacity-100" style={{ background: uptimeColor(day.uptime) }} />
          </Tooltip>
        );
      })}
    </div>
  );
}

// ── Segmented bar ───────────────────────────────────────────────────────────

export interface Segment {
  label: string;
  value: number;
  color: string;
  icon?: React.ReactNode;
}

/** One whole split into parts, with a legend that carries name, count, and share. */
export function SegmentedBar({ segments, total, className }: { segments: Segment[]; total?: number; className?: string }) {
  const sum = total ?? segments.reduce((acc, segment) => acc + segment.value, 0);
  const visible = segments.filter((segment) => segment.value > 0);
  return (
    <div className={className}>
      <div className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full" role="img" aria-label={segments.map((segment) => `${segment.label}: ${segment.value}`).join(", ")}>
        {sum === 0 ? <span className="flex-1 rounded-full bg-surface-3" /> : visible.map((segment) => (
          <span key={segment.label} className="rounded-full" style={{ width: `${(segment.value / sum) * 100}%`, background: segment.color, minWidth: 6 }} />
        ))}
      </div>
      <ul className="mt-4 flex flex-col gap-2.5">
        {segments.map((segment) => (
          <li key={segment.label} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2 text-text-2">
              <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: segment.color }} />
              {segment.icon}
              {segment.label}
            </span>
            <span className="flex items-baseline gap-2 tabular">
              <span className="font-medium text-text">{segment.value}</span>
              <span className="w-10 text-right text-xs text-muted">{sum ? `${Math.round((segment.value / sum) * 100)}%` : "—"}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Ranked bars ─────────────────────────────────────────────────────────────

export interface RankedRow {
  key: string;
  label: React.ReactNode;
  value: number;
  display: string;
  hint?: string;
}

/** Horizontal bars on one baseline, one hue: the right form for comparing categories. */
export function RankedBars({ rows, color = "var(--chart-1)", max, className }: { rows: RankedRow[]; color?: string; max?: number; className?: string }) {
  const top = max ?? Math.max(1, ...rows.map((row) => row.value));
  return (
    <ul className={cn("flex flex-col gap-3", className)}>
      {rows.map((row) => (
        <li key={row.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
          <span className="truncate text-sm text-text-2">{row.label}</span>
          <span className="text-sm font-medium text-text tabular">{row.display}{row.hint && <span className="ml-1.5 text-xs font-normal text-muted">{row.hint}</span>}</span>
          <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
            <span className="block h-full rounded-full" style={{ width: `${Math.max(row.value > 0 ? 2 : 0, (row.value / top) * 100)}%`, background: color }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

// ── Heatmap ─────────────────────────────────────────────────────────────────

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Failed checks by weekday and hour (UTC). One hue, stepped by magnitude, with a scale legend. */
export function FailureHeatmap({ cells }: { cells: { weekday: number; hour: number; failed: number; total: number }[] }) {
  const index = new Map(cells.map((cell) => [`${cell.weekday}:${cell.hour}`, cell]));
  const max = Math.max(0, ...cells.map((cell) => cell.failed));
  const step = (failed: number) => (failed === 0 || max === 0 ? 0 : Math.min(5, Math.ceil((failed / max) * 5)));
  return (
    <div>
      <div className="grid gap-[2px]" style={{ gridTemplateColumns: "2rem repeat(24, minmax(0, 1fr))" }} role="table" aria-label="Failed checks by weekday and hour, UTC">
        {WEEKDAYS.map((day, weekday) => (
          <div key={day} className="contents" role="row">
            <span className="self-center text-2xs text-muted" role="rowheader">{day}</span>
            {Array.from({ length: 24 }, (_, hour) => {
              const cell = index.get(`${weekday}:${hour}`);
              const failed = cell?.failed ?? 0;
              const text = `${day} ${String(hour).padStart(2, "0")}:00 UTC — ${failed} failed of ${cell?.total ?? 0} checks`;
              return (
                <Tooltip key={hour} content={text}>
                  <span role="cell" tabIndex={0} aria-label={text} className="aspect-square min-h-2.5 rounded-[3px]" style={{ background: `var(--seq-${step(failed)})` }} />
                </Tooltip>
              );
            })}
          </div>
        ))}
        <span />
        {Array.from({ length: 24 }, (_, hour) => <span key={hour} className="pt-1 text-center text-2xs text-muted">{hour % 6 === 0 ? String(hour).padStart(2, "0") : ""}</span>)}
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5 text-2xs text-muted">
        Fewer
        {[0, 1, 2, 3, 4, 5].map((level) => <span key={level} className="size-2.5 rounded-[3px]" style={{ background: `var(--seq-${level})` }} />)}
        More failures
      </div>
    </div>
  );
}
