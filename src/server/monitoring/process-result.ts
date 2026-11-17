import { formatDurationWords } from "@/shared/format";
import { ActivityLevel, ActivityType, DataOrigin, MonitorStatus, NotificationEvent } from "@/shared/enums";
import type { RealtimeEvent } from "@/shared/realtime";
import { routes } from "@/shared/routes";

import { isRetryableTransactionError, prisma } from "../db";
import { handleMonitorDown, handleMonitorRecovered } from "../modules/incidents/automation";
import { recordActivity } from "../modules/activity/record";
import { enqueueNotifications } from "../modules/notifications/outbox";
import { publish } from "../realtime/publisher";
import type { CheckOutcome } from "./http-check";
import { nextMonitorState } from "./state-machine";

export interface ApplyResult {
  applied: boolean;
  status?: MonitorStatus;
  transition?: string | null;
  incidentId?: string | null;
}

/**
 * Applies one check result: stores it, advances the state machine, and runs
 * incident automation and notifications, all in a single transaction.
 *
 * The monitor row is locked `FOR UPDATE` first. That serializes result
 * processing per monitor, so counters cannot be corrupted by two results
 * racing, and incident deduplication cannot be bypassed. Real-time events are
 * published only after the commit.
 */
export async function applyCheckResult(
  monitorId: string,
  organizationId: string,
  outcome: CheckOutcome,
  checkedAt: Date = new Date(),
): Promise<ApplyResult> {
  for (let attempt = 1; ; attempt++) {
    try {
      const { result, events } = await prisma.$transaction(
        async (tx) => {
          const events: RealtimeEvent[] = [];
          // Scoped by organization as well as id: a job payload can never touch another tenant's monitor.
          const locked = await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM "Monitor"
            WHERE id = ${monitorId}::uuid AND "organizationId" = ${organizationId}::uuid
            FOR UPDATE`;
          if (locked.length === 0) return { result: { applied: false } as ApplyResult, events };

          const monitor = await tx.monitor.findUniqueOrThrow({
            where: { id: monitorId },
            include: { organization: { select: { id: true, name: true, slug: true, autoResolveIncidents: true } } },
          });
          // Paused or deleted while the check was in flight: discard the result.
          if (!monitor.enabled) return { result: { applied: false } as ApplyResult, events };

          await tx.monitorCheck.create({
            data: {
              monitorId,
              organizationId,
              status: outcome.status,
              statusCode: outcome.statusCode,
              responseTimeMs: outcome.responseTimeMs,
              dnsMs: outcome.dnsMs,
              connectMs: outcome.connectMs,
              tlsMs: outcome.tlsMs,
              ttfbMs: outcome.ttfbMs,
              errorType: outcome.errorType,
              errorMessage: outcome.errorMessage?.slice(0, 500) ?? null,
              attempts: outcome.attempts,
              origin: DataOrigin.LIVE,
              checkedAt,
            },
          });

          const next = nextMonitorState(
            {
              status: monitor.status,
              consecutiveFailures: monitor.consecutiveFailures,
              consecutiveSuccesses: monitor.consecutiveSuccesses,
            },
            outcome.status,
            monitor,
          );
          const downSince = monitor.status === MonitorStatus.DOWN ? monitor.lastStatusChangeAt : null;

          await tx.monitor.update({
            where: { id: monitorId },
            data: {
              status: next.status,
              consecutiveFailures: next.consecutiveFailures,
              consecutiveSuccesses: next.consecutiveSuccesses,
              lastCheckedAt: checkedAt,
              lastResponseTimeMs: outcome.responseTimeMs,
              lastStatusCode: outcome.statusCode,
              ...(outcome.ok
                ? { lastSuccessAt: checkedAt, lastErrorType: null, lastErrorMessage: null }
                : { lastFailureAt: checkedAt, lastErrorType: outcome.errorType, lastErrorMessage: outcome.errorMessage?.slice(0, 500) ?? null }),
              ...(next.statusChanged ? { lastStatusChangeAt: checkedAt } : {}),
            },
          });

          events.push({ type: "monitor.checked", monitorId, status: next.status });
          if (next.statusChanged) {
            events.push({ type: "monitor.status_changed", monitorId, name: monitor.name, from: monitor.status, to: next.status });
          }

          const org = monitor.organization;
          const monitorPath = routes.org(org.slug).monitor(monitorId);
          let incidentId: string | null = null;

          if (next.transition === "went_down") {
            const reason = outcome.errorMessage ?? "The check failed.";
            await recordActivity(tx, {
              organizationId,
              type: ActivityType.MONITOR_DOWN,
              level: ActivityLevel.CRITICAL,
              title: `${monitor.name} is down`,
              description: reason,
              monitorId,
              occurredAt: checkedAt,
            });
            await enqueueNotifications(tx, {
              organizationId,
              event: NotificationEvent.MONITOR_DOWN,
              occurrenceKey: `monitor.down:${monitorId}:${checkedAt.getTime()}`,
              subject: `[Down] ${monitor.name}`,
              monitorId,
              payload: {
                headline: `${monitor.name} is down`,
                facts: [
                  { label: "Monitor", value: monitor.name },
                  { label: "Failed checks", value: `${next.consecutiveFailures} in a row` },
                  { label: "Last error", value: reason },
                ],
                path: monitorPath,
                organization: { name: org.name, slug: org.slug },
                monitor: { id: monitorId, name: monitor.name, url: monitor.url },
                occurredAt: checkedAt.toISOString(),
              },
            });
            const automation = await handleMonitorDown(tx, org, monitor, { errorMessage: outcome.errorMessage, at: checkedAt });
            events.push(...automation.events, { type: "activity.created" });
            incidentId = automation.incidentId;
          } else if (next.transition === "recovered") {
            const downFor = downSince ? formatDurationWords((checkedAt.getTime() - downSince.getTime()) / 1000) : null;
            await recordActivity(tx, {
              organizationId,
              type: ActivityType.MONITOR_RECOVERED,
              level: ActivityLevel.SUCCESS,
              title: `${monitor.name} recovered`,
              description: downFor ? `Down for ${downFor}.` : null,
              monitorId,
              occurredAt: checkedAt,
            });
            await enqueueNotifications(tx, {
              organizationId,
              event: NotificationEvent.MONITOR_RECOVERED,
              occurrenceKey: `monitor.recovered:${monitorId}:${checkedAt.getTime()}`,
              subject: `[Recovered] ${monitor.name}`,
              monitorId,
              payload: {
                headline: `${monitor.name} recovered`,
                facts: [
                  { label: "Monitor", value: monitor.name },
                  ...(downFor ? [{ label: "Downtime", value: downFor }] : []),
                  { label: "Response time", value: outcome.responseTimeMs === null ? "n/a" : `${outcome.responseTimeMs} ms` },
                ],
                path: monitorPath,
                organization: { name: org.name, slug: org.slug },
                monitor: { id: monitorId, name: monitor.name, url: monitor.url },
                occurredAt: checkedAt.toISOString(),
              },
            });
            const automation = await handleMonitorRecovered(tx, org, monitor, { at: checkedAt, downSince });
            events.push(...automation.events, { type: "activity.created" });
            incidentId = automation.incidentId;
          } else if (next.transition === "degraded") {
            await recordActivity(tx, {
              organizationId,
              type: ActivityType.MONITOR_DEGRADED,
              level: ActivityLevel.WARNING,
              title: `${monitor.name} is degraded`,
              description: outcome.ok
                ? `Responding slowly (${outcome.responseTimeMs} ms).`
                : (outcome.errorMessage ?? "A check failed."),
              monitorId,
              occurredAt: checkedAt,
            });
            events.push({ type: "activity.created" });
          }

          return {
            result: { applied: true, status: next.status, transition: next.transition, incidentId } as ApplyResult,
            events,
          };
        },
        { timeout: 15_000 },
      );

      await publish(organizationId, ...events);
      return result;
    } catch (error) {
      if (attempt < 3 && isRetryableTransactionError(error)) continue;
      throw error;
    }
  }
}
