# Metric definitions

Every number in the product is computed from stored records by the formulas below. The pure functions are in `src/shared/uptime.ts`; the SQL is in `src/server/modules/metrics/queries.ts`.

## Check status

| Status | Meaning |
|---|---|
| `UP` | The response arrived in time with an expected status code. |
| `DEGRADED` | As `UP`, but slower than the monitor's degraded threshold. |
| `DOWN` | Timeout, DNS/TLS/connection failure, unexpected status code, redirect problem, or blocked by the network policy, after in-check retries. |

## Uptime

```
uptime % = (total checks − DOWN checks) ÷ total checks × 100
```

- `DEGRADED` counts as available.
- Paused periods produce no checks, so they neither help nor hurt.
- With zero checks the value is **undefined** and shown as "—", never 100%.
- Across monitors or periods, counts are summed first and divided once. Percentages are never averaged.
- Display truncates rather than rounds: 99.996% is shown as 99.99%, not 100%.

This is check-based availability. It is as precise as the check interval: a monitor checked every 5 minutes cannot see a 2-minute outage.

## Estimated downtime

```
estimated downtime = DOWN checks × check interval
```

An estimate, labelled as one in the UI.

## Response time

Time from starting the request to receiving response headers, including redirects, for the final attempt of a check. Failed checks are excluded from averages and percentiles.

- **Average**: arithmetic mean.
- **p50 / p95 / p99**: nearest-rank percentiles (`percentile_disc`).

## Outages

On the monitor page, an outage is a maximal run of consecutive `DOWN` checks. It starts at the first failed check and ends at the next non-failed check. Available for windows computed from raw checks.

## Time windows and aggregation

| Window | Source | Bucket |
|---|---|---|
| 24 hours | raw checks | 30 minutes |
| 7 days | raw checks | 6 hours |
| 30 days | daily rollups | 1 UTC day |
| 90 days | daily rollups | 1 UTC day |

Daily rollups store per-monitor counts, mean, min, max, and p50/p95/p99 for each UTC day.

**Approximation to be aware of:** percentiles cannot be merged exactly. For daily-rollup windows, a percentile spanning several days or several monitors is the check-weighted mean of the stored daily percentiles. Counts, uptime, and means are exact.

Error breakdowns, the failure heatmap, connection timing, the outage list, and the response-time distribution need individual checks and are shown only for the 24-hour and 7-day windows.

## Period comparison

A delta compares the selected window with the immediately preceding window of equal length. Uptime deltas are in percentage points; latency and counts are relative changes.

## Incident metrics

- **Incidents opened**: incidents whose `startedAt` falls in the window.
- **Mean time to resolve (MTTR)**: mean of `resolvedAt − startedAt` over incidents **resolved** in the window.
- **Active incidents**: incidents not in `RESOLVED` right now, regardless of window.

## Sample data

Rows created by the seed carry `origin = SEED` (checks, rollups) or `isSample = true` (incidents, activity, audit entries). Pages that mix seeded and live checks state the proportion.
