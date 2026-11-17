"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { SegmentedControl } from "@/components/ui/tabs";
import { orgKey, useOrg } from "@/features/org/org-context";
import { api } from "@/lib/api-client";
import { TIME_RANGE_KEYS, TIME_RANGES, type TimeRange } from "@/shared/constants";
import { formatMs } from "@/shared/format";
import type { MetricWithPrevious } from "@/shared/types";
import { pointChange, relativeChange } from "@/shared/uptime";

/** Org-scoped GET with previous data held on screen while a new window loads. */
export function useOrgQuery<T>(key: unknown[], path: string, query?: Record<string, string | number | boolean | string[] | null | undefined>, options: { enabled?: boolean; refetchInterval?: number } = {}) {
  const org = useOrg();
  return useQuery({
    queryKey: orgKey(org.organization.slug, ...key, query ?? {}),
    queryFn: ({ signal }) => api.get<T>(`${org.api}${path}`, query, signal),
    placeholderData: keepPreviousData,
    ...options,
  });
}

export function RangePicker({ value, onChange }: { value: TimeRange; onChange: (range: TimeRange) => void }) {
  return <SegmentedControl label="Time range" value={value} onChange={onChange} options={TIME_RANGE_KEYS.map((key) => ({ value: key, label: TIME_RANGES[key].short }))} />;
}

type Delta = { text: string; direction: "up" | "down" | "flat"; good: boolean | null } | null;

/** Change in percentage points, for metrics that are already percentages. */
export function pointsDelta(metric: MetricWithPrevious, higherIsBetter = true): Delta {
  const change = pointChange(metric.value, metric.previous);
  if (change === null) return null;
  if (Math.abs(change) < 0.005) return { text: "No change", direction: "flat", good: null };
  return { text: `${change > 0 ? "+" : "−"}${Math.abs(change).toFixed(2)} pts`, direction: change > 0 ? "up" : "down", good: change > 0 === higherIsBetter };
}

/** Relative change, for magnitudes such as latency or counts. */
export function percentDelta(metric: MetricWithPrevious, higherIsBetter: boolean): Delta {
  const change = relativeChange(metric.value, metric.previous);
  if (change === null) {
    if (metric.value !== null && metric.previous === 0 && metric.value > 0) return { text: `+${metric.value}`, direction: "up", good: higherIsBetter };
    return null;
  }
  if (Math.abs(change) < 0.005) return { text: "No change", direction: "flat", good: null };
  return { text: `${change > 0 ? "+" : "−"}${Math.abs(change * 100).toFixed(change * 100 >= 100 ? 0 : 1)}%`, direction: change > 0 ? "up" : "down", good: change > 0 === higherIsBetter };
}

export const msOrDash = (value: number | null) => formatMs(value);

export function OriginNote({ origin }: { origin: { live: number; seed: number } }) {
  if (origin.seed === 0) return null;
  const total = origin.live + origin.seed;
  const share = total ? Math.round((origin.seed / total) * 100) : 0;
  return <p className="text-xs text-muted">{share === 100 ? "All" : `${share}% of`} checks in this window are seeded sample data{origin.live > 0 ? "; the rest are live results." : "."}</p>;
}
