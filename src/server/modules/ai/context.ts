import { IncidentUpdateKind } from "@/shared/enums";

import { prisma } from "../../db";
import { notFound } from "../../errors";
import type { OrgContext } from "../../tenancy";
import { loadTotals, previousWindow, resolveWindow } from "../metrics/queries";

/**
 * Builds the context sent to the model, and nothing more.
 *
 * Data minimization is the security control here: the model receives
 * aggregates and sanitized error categories, not raw records. It never sees
 * monitor URLs or hostnames, member names or emails, internal notes, request
 * or response bodies, or any configuration secret.
 */

const MAX_TEXT = 400;
const MAX_ERRORS = 6;
const MAX_TIMELINE = 12;
const MAX_MONITORS = 5;

/** Strips anything that could identify infrastructure or carry a credential. */
export function sanitizeForModel(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/\bhttps?:\/\/[^\s"'<>)]+/gi, "[url]")
    .replace(/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, "[email]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, "[ip]")
    .replace(/\b(?:[a-f0-9]{1,4}:){3,7}[a-f0-9]{1,4}\b/gi, "[ip]")
    .replace(/\b(?:bearer|token|apikey|api[_-]key|secret|password)\b\s*[:=]?\s*\S+/gi, "[credential]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[token]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT);
}

export interface IncidentAnalysisContext {
  incident: { reference: string; title: string; severity: string; status: string; source: string; startedAt: string; minutesOpen: number };
  monitors: {
    label: string; kind: string; method: string; currentStatus: string; intervalSeconds: number; timeoutMs: number;
    lastHour: { checks: number; failed: number; avgResponseMs: number | null; p95ResponseMs: number | null };
    previousHour: { checks: number; failed: number; avgResponseMs: number | null; p95ResponseMs: number | null };
    recentErrors: { category: string; message: string; count: number }[];
  }[];
  timeline: { at: string; kind: "update" | "system"; status: string | null; text: string }[];
}

export async function buildIncidentContext(ctx: OrgContext, incidentId: string, now: Date = new Date()): Promise<IncidentAnalysisContext> {
  const incident = await prisma.incident.findFirst({
    where: { id: incidentId, organizationId: ctx.organization.id },
    select: {
      number: true, title: true, severity: true, status: true, source: true, startedAt: true, resolvedAt: true,
      monitors: {
        take: MAX_MONITORS,
        select: { monitor: { select: { id: true, kind: true, method: true, status: true, intervalSeconds: true, timeoutMs: true } } },
      },
      // Internal notes are a different table and are intentionally not read.
      updates: { orderBy: { createdAt: "desc" }, take: MAX_TIMELINE, select: { createdAt: true, kind: true, status: true, message: true } },
    },
  });
  if (!incident) throw notFound("Incident");

  const end = incident.resolvedAt ?? now;
  const lastHour = { ...resolveWindow("24h", end), from: new Date(end.getTime() - 3_600_000), to: end };
  const previousHour = previousWindow(lastHour);

  const monitors = await Promise.all(
    incident.monitors.map(async ({ monitor }, index) => {
      const [recent, earlier, errors] = await Promise.all([
        loadTotals(ctx.organization.id, lastHour, monitor.id),
        loadTotals(ctx.organization.id, previousHour, monitor.id),
        prisma.monitorCheck.groupBy({
          by: ["errorType", "errorMessage"],
          where: { organizationId: ctx.organization.id, monitorId: monitor.id, status: "DOWN", checkedAt: { gte: new Date(end.getTime() - 6 * 3_600_000), lte: end } },
          _count: true, orderBy: { _count: { errorType: "desc" } }, take: MAX_ERRORS,
        }),
      ]);
      const window = (totals: typeof recent) => ({ checks: totals.total, failed: totals.down, avgResponseMs: totals.avgMs, p95ResponseMs: totals.p95Ms });
      return {
        // Monitors are referred to by position: names and URLs can reveal internal topology.
        label: `Monitor ${String.fromCharCode(65 + index)}`,
        kind: monitor.kind, method: monitor.method, currentStatus: monitor.status, intervalSeconds: monitor.intervalSeconds, timeoutMs: monitor.timeoutMs,
        lastHour: window(recent), previousHour: window(earlier),
        recentErrors: errors.map((row) => ({ category: row.errorType ?? "UNKNOWN", message: sanitizeForModel(row.errorMessage), count: row._count })),
      };
    }),
  );

  return {
    incident: {
      reference: `INC-${incident.number}`, title: sanitizeForModel(incident.title), severity: incident.severity, status: incident.status,
      source: incident.source, startedAt: incident.startedAt.toISOString(),
      minutesOpen: Math.max(0, Math.round((end.getTime() - incident.startedAt.getTime()) / 60_000)),
    },
    monitors,
    timeline: incident.updates.reverse().map((update) => ({
      at: update.createdAt.toISOString(), kind: update.kind === IncidentUpdateKind.SYSTEM ? ("system" as const) : ("update" as const),
      status: update.status, text: sanitizeForModel(update.message),
    })),
  };
}
