"use client";

import { BarChart3, Table2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Table, TableContainer, Td, Th, Tr } from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";

export interface LegendItem {
  label: string;
  /** A CSS colour (usually a `var(--chart-n)` token). */
  color: string;
  shape?: "line" | "rect";
}

export interface ChartTable {
  columns: string[];
  rows: (string | number)[][];
}

interface ChartCardProps {
  title: string;
  description?: string;
  legend?: LegendItem[];
  /** The same data as rows: the accessible twin of the chart. */
  table?: ChartTable;
  loading?: boolean;
  /** True while refetching with previous data on screen: the frame is held, dimmed. */
  refreshing?: boolean;
  error?: boolean;
  onRetry?: () => void;
  empty?: boolean;
  emptyMessage?: string;
  height?: number;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-xs text-text-2">
          <span aria-hidden className={cn("shrink-0", item.shape === "rect" ? "size-2.5 rounded-[3px]" : "h-0.5 w-3 rounded-full")} style={{ background: item.color }} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * The frame every chart sits in. It owns the title, the legend (shown for two
 * or more series), the loading / empty / error states, and the table view.
 */
export function ChartCard({ title, description, legend, table, loading, refreshing, error, onRetry, empty, emptyMessage, height = 240, actions, className, children }: ChartCardProps) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const showTable = view === "table" && table;

  return (
    <Card className={cn("flex min-w-0 flex-col", className)}>
      <div className="flex items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-text">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          {table && !loading && !error && !empty && (
            <Tooltip content={view === "chart" ? "View as table" : "View as chart"}>
              <Button variant="ghost" size="icon-sm" aria-label={view === "chart" ? "View as table" : "View as chart"} aria-pressed={view === "table"} onClick={() => setView(view === "chart" ? "table" : "chart")}>
                {view === "chart" ? <Table2 /> : <BarChart3 />}
              </Button>
            </Tooltip>
          )}
        </div>
      </div>
      {legend && legend.length > 1 && !loading && !error && !empty && <div className="px-5 pt-2"><ChartLegend items={legend} /></div>}

      <div className="px-5 pt-3 pb-4" aria-busy={loading || refreshing || undefined}>
        {loading ? (
          <Skeleton style={{ height }} className="w-full rounded-lg" />
        ) : error ? (
          <ErrorState className="py-6" onRetry={onRetry} />
        ) : empty ? (
          <EmptyState icon={BarChart3} title="No data in this window" description={emptyMessage ?? "Checks will appear here as soon as they run."} className="py-8" />
        ) : showTable ? (
          <TableContainer className="rounded-lg border border-border" style={{ maxHeight: height + 40 }}>
            <Table>
              <thead className="sticky top-0 bg-surface-2"><tr>{table.columns.map((column) => <Th key={column} className="first:pl-3 last:pr-3">{column}</Th>)}</tr></thead>
              <tbody>
                {table.rows.map((row, index) => (
                  <Tr key={index}>{row.map((cell, cellIndex) => <Td key={cellIndex} className={cn("h-8 text-xs first:pl-3 last:pr-3", cellIndex > 0 && "tabular")}>{cell}</Td>)}</Tr>
                ))}
              </tbody>
            </Table>
          </TableContainer>
        ) : (
          <div className={cn("transition-opacity duration-200", refreshing && "opacity-50")} style={{ height }}>{children}</div>
        )}
      </div>
    </Card>
  );
}
