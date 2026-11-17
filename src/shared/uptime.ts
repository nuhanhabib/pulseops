/**
 * Availability maths. Pure functions, shared by the API, the seed, and the UI,
 * and covered by unit tests. The definitions here are the ones documented in
 * docs/metrics.md; change them together.
 */

export interface CheckCounts {
  total: number;
  down: number;
}

/**
 * Uptime = checks that were not DOWN ÷ all checks, as a percentage.
 *
 * - A DEGRADED check (slow but correct) counts as available.
 * - Paused periods produce no checks, so they neither help nor hurt.
 * - With no checks there is no evidence either way: the answer is `null`,
 *   never a flattering 100.
 */
export function uptimePercent({ total, down }: CheckCounts): number | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  const available = Math.max(0, total - Math.max(0, down));
  return (available / total) * 100;
}

/** Combine windows by summing counts, never by averaging percentages. */
export function combineCounts(windows: CheckCounts[]): CheckCounts {
  return windows.reduce<CheckCounts>(
    (sum, window) => ({ total: sum.total + window.total, down: sum.down + window.down }),
    { total: 0, down: 0 },
  );
}

/**
 * Each failed check is taken to represent one full check interval of
 * downtime. This is an estimate: a monitor checked every 5 minutes cannot
 * see an outage shorter than that.
 */
export function estimatedDowntimeSeconds(failedChecks: number, intervalSeconds: number): number {
  return Math.max(0, failedChecks) * Math.max(0, intervalSeconds);
}

/**
 * Nearest-rank percentile on an ascending-sorted array. Matches Postgres'
 * `percentile_disc`, which the SQL aggregates use.
 */
export function percentile(sortedAscending: number[], p: number): number | null {
  if (sortedAscending.length === 0) return null;
  const clamped = Math.min(1, Math.max(0, p));
  const rank = Math.max(1, Math.ceil(clamped * sortedAscending.length));
  return sortedAscending[rank - 1] ?? null;
}

/** Relative change from `previous` to `current`, as a fraction. Null when undefined. */
export function relativeChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return (current - previous) / previous;
}

/** Difference in percentage points, for metrics that are already percentages. */
export function pointChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return current - previous;
}

/**
 * Format an uptime percentage without rounding a bad number up to a good one:
 * 99.996% must not display as "100%". Truncates instead of rounding.
 */
export function formatUptime(value: number | null, fractionDigits = 2): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (value >= 100) return "100%";
  const factor = 10 ** fractionDigits;
  const truncated = Math.floor(value * factor) / factor;
  return `${truncated.toFixed(fractionDigits)}%`;
}
