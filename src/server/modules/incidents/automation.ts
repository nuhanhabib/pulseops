import { formatDurationWords } from "@/shared/format";
import {
  ActivityLevel,
  ActivityType,
  IncidentSource,
  IncidentStatus,
  IncidentUpdateKind,
  MonitorStatus,
  NotificationEvent,
} from "@/shared/enums";
import type { RealtimeEvent } from "@/shared/realtime";
import { routes } from "@/shared/routes";

import { recordSystemAudit } from "../../audit";
import type { DbClient } from "../../db";
import { recordActivity } from "../activity/record";
import { enqueueNotifications } from "../notifications/outbox";

/**
 * Incident automation, driven by monitor state transitions.
 *
 * Both functions must be called inside the transaction that holds the row
 * lock on the monitor. That lock serializes check processing per monitor, and
 * is what makes "is there already an open incident?" followed by "create one"
 * free of races, so repeated failing checks can never open duplicates.
 */

export interface AutomationMonitor {
  id: string;
  organizationId: string;
  name: string;
  url: string;
  autoIncident: boolean;
  incidentSeverity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  failureThreshold: number;
}

interface OrgRef {
  id: string;
  name: string;
  slug: string;
  autoResolveIncidents: boolean;
}

export interface AutomationResult {
  events: RealtimeEvent[];
  incidentId: string | null;
}

/** Allocates the next INC-n number. The row lock on Organization makes it gap-free under concurrency. */
export async function nextIncidentNumber(db: DbClient, organizationId: string): Promise<number> {
  const org = await db.organization.update({
    where: { id: organizationId },
    data: { incidentCounter: { increment: 1 } },
    select: { incidentCounter: true },
  });
  return org.incidentCounter;
}

export async function handleMonitorDown(
  db: DbClient,
  org: OrgRef,
  monitor: AutomationMonitor,
  failure: { errorMessage: string | null; at: Date },
): Promise<AutomationResult> {
  const events: RealtimeEvent[] = [];
  const reason = failure.errorMessage ?? "The check failed.";

  // Deduplication: any unresolved incident already linked to this monitor absorbs the new outage.
  const existing = await db.incident.findFirst({
    where: {
      organizationId: org.id,
      status: { not: IncidentStatus.RESOLVED },
      monitors: { some: { monitorId: monitor.id } },
    },
    orderBy: { startedAt: "desc" },
    select: { id: true, number: true, title: true, status: true, severity: true },
  });

  if (existing) {
    const relapsed = existing.status === IncidentStatus.MONITORING;
    await db.incidentUpdate.create({
      data: {
        incidentId: existing.id,
        organizationId: org.id,
        kind: IncidentUpdateKind.SYSTEM,
        status: relapsed ? IncidentStatus.INVESTIGATING : null,
        message: `${monitor.name} is failing${relapsed ? " again" : ""}: ${reason}`,
        createdAt: failure.at,
      },
    });
    if (relapsed) {
      await db.incident.update({ where: { id: existing.id }, data: { status: IncidentStatus.INVESTIGATING } });
    }
    events.push({ type: "incident.updated", incidentId: existing.id, number: existing.number });
    return { events, incidentId: existing.id };
  }

  if (!monitor.autoIncident) return { events, incidentId: null };

  const number = await nextIncidentNumber(db, org.id);
  const title = `${monitor.name} is down`;
  const incident = await db.incident.create({
    data: {
      organizationId: org.id,
      number,
      title,
      summary: `Opened automatically after ${monitor.failureThreshold} consecutive failed checks.`,
      status: IncidentStatus.INVESTIGATING,
      severity: monitor.incidentSeverity,
      source: IncidentSource.AUTOMATED,
      startedAt: failure.at,
      monitors: { create: { monitorId: monitor.id, organizationId: org.id } },
      updates: {
        create: {
          organizationId: org.id,
          kind: IncidentUpdateKind.SYSTEM,
          status: IncidentStatus.INVESTIGATING,
          message: `Incident opened automatically. ${monitor.name} failed ${monitor.failureThreshold} consecutive checks. Last error: ${reason}`,
          createdAt: failure.at,
        },
      },
    },
    select: { id: true, number: true, severity: true, status: true },
  });

  await recordActivity(db, {
    organizationId: org.id,
    type: ActivityType.INCIDENT_OPENED,
    level: ActivityLevel.CRITICAL,
    title: `INC-${number} opened: ${title}`,
    description: reason,
    monitorId: monitor.id,
    incidentId: incident.id,
    occurredAt: failure.at,
  });
  await recordSystemAudit(db, org.id, {
    action: "incident.created",
    target: { type: "incident", id: incident.id, label: `INC-${number}` },
    metadata: { source: "automation", monitorId: monitor.id, monitorName: monitor.name },
  });
  await enqueueNotifications(db, {
    organizationId: org.id,
    event: NotificationEvent.INCIDENT_CREATED,
    occurrenceKey: `incident.created:${incident.id}`,
    subject: `[${incident.severity}] INC-${number}: ${title}`,
    incidentId: incident.id,
    monitorId: monitor.id,
    payload: {
      headline: `Incident INC-${number} opened`,
      facts: [
        { label: "Incident", value: title },
        { label: "Severity", value: incident.severity },
        { label: "Affected monitor", value: monitor.name },
        { label: "Last error", value: reason },
      ],
      path: routes.org(org.slug).incident(incident.id),
      organization: { name: org.name, slug: org.slug },
      monitor: { id: monitor.id, name: monitor.name, url: monitor.url },
      incident: { id: incident.id, number, title, severity: incident.severity, status: incident.status },
      occurredAt: failure.at.toISOString(),
    },
  });

  events.push({ type: "incident.created", incidentId: incident.id, number, title, severity: incident.severity, automated: true });
  return { events, incidentId: incident.id };
}

export async function handleMonitorRecovered(
  db: DbClient,
  org: OrgRef,
  monitor: AutomationMonitor,
  recovery: { at: Date; downSince: Date | null },
): Promise<AutomationResult> {
  const events: RealtimeEvent[] = [];
  const downFor = recovery.downSince ? formatDurationWords((recovery.at.getTime() - recovery.downSince.getTime()) / 1000) : null;

  const open = await db.incident.findMany({
    where: {
      organizationId: org.id,
      status: { not: IncidentStatus.RESOLVED },
      monitors: { some: { monitorId: monitor.id } },
    },
    select: {
      id: true,
      number: true,
      title: true,
      source: true,
      severity: true,
      startedAt: true,
      monitors: { select: { monitor: { select: { id: true, status: true, enabled: true } } } },
    },
  });

  let lastIncidentId: string | null = null;
  for (const incident of open) {
    lastIncidentId = incident.id;
    // The recovering monitor's own row still says DOWN inside this transaction, so exclude it explicitly.
    const othersHealthy = incident.monitors.every(
      ({ monitor: linked }) => linked.id === monitor.id || !linked.enabled || linked.status !== MonitorStatus.DOWN,
    );
    const autoResolve = incident.source === IncidentSource.AUTOMATED && org.autoResolveIncidents && othersHealthy;

    if (autoResolve) {
      await db.incident.update({
        where: { id: incident.id },
        data: { status: IncidentStatus.RESOLVED, resolvedAt: recovery.at },
      });
      await db.incidentUpdate.create({
        data: {
          incidentId: incident.id,
          organizationId: org.id,
          kind: IncidentUpdateKind.SYSTEM,
          status: IncidentStatus.RESOLVED,
          message: `Resolved automatically. ${monitor.name} recovered${downFor ? ` after ${downFor}` : ""} and all linked monitors are healthy.`,
          createdAt: recovery.at,
        },
      });
      await recordActivity(db, {
        organizationId: org.id,
        type: ActivityType.INCIDENT_RESOLVED,
        level: ActivityLevel.SUCCESS,
        title: `INC-${incident.number} resolved: ${incident.title}`,
        description: "Resolved automatically after recovery.",
        monitorId: monitor.id,
        incidentId: incident.id,
        occurredAt: recovery.at,
      });
      await recordSystemAudit(db, org.id, {
        action: "incident.resolved",
        target: { type: "incident", id: incident.id, label: `INC-${incident.number}` },
        metadata: { source: "automation", monitorId: monitor.id },
      });
      await enqueueNotifications(db, {
        organizationId: org.id,
        event: NotificationEvent.INCIDENT_RESOLVED,
        occurrenceKey: `incident.resolved:${incident.id}:${recovery.at.getTime()}`,
        subject: `[Resolved] INC-${incident.number}: ${incident.title}`,
        incidentId: incident.id,
        monitorId: monitor.id,
        payload: {
          headline: `Incident INC-${incident.number} resolved`,
          facts: [
            { label: "Incident", value: incident.title },
            { label: "Duration", value: formatDurationWords((recovery.at.getTime() - incident.startedAt.getTime()) / 1000) },
            { label: "Resolution", value: "Automatic, after the affected monitor recovered." },
          ],
          path: routes.org(org.slug).incident(incident.id),
          organization: { name: org.name, slug: org.slug },
          monitor: { id: monitor.id, name: monitor.name, url: monitor.url },
          incident: { id: incident.id, number: incident.number, title: incident.title, severity: incident.severity, status: IncidentStatus.RESOLVED },
          occurredAt: recovery.at.toISOString(),
        },
      });
      events.push({ type: "incident.resolved", incidentId: incident.id, number: incident.number, title: incident.title, automated: true });
    } else {
      // A person owns this incident (or other monitors are still down): report the recovery, leave the decision to them.
      await db.incidentUpdate.create({
        data: {
          incidentId: incident.id,
          organizationId: org.id,
          kind: IncidentUpdateKind.SYSTEM,
          message: `${monitor.name} recovered${downFor ? ` after ${downFor}` : ""}.`,
          createdAt: recovery.at,
        },
      });
      events.push({ type: "incident.updated", incidentId: incident.id, number: incident.number });
    }
  }

  return { events, incidentId: lastIncidentId };
}
