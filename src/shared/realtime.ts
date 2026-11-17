import type { IncidentSeverity, MonitorStatus } from "./enums";

/**
 * Events pushed to the browser over Server-Sent Events.
 *
 * They are deliberately thin: an event says *what changed*, never *what the
 * new data is*. The client reacts by refetching through the normal, authorized
 * REST API. That keeps one code path responsible for access control, and means
 * a missed or duplicated event can only cost a refetch, never correctness.
 */
export type RealtimeEvent =
  | { type: "monitor.checked"; monitorId: string; status: MonitorStatus }
  | { type: "monitor.status_changed"; monitorId: string; name: string; from: MonitorStatus; to: MonitorStatus }
  | { type: "monitor.changed"; monitorId: string; change: "created" | "updated" | "deleted" }
  | { type: "incident.created"; incidentId: string; number: number; title: string; severity: IncidentSeverity; automated: boolean }
  | { type: "incident.updated"; incidentId: string; number: number }
  | { type: "incident.resolved"; incidentId: string; number: number; title: string; automated: boolean }
  | { type: "activity.created" }
  | { type: "notification.updated" }
  | { type: "statuspage.changed" };

export type RealtimeEventType = RealtimeEvent["type"];

/** What actually travels over the wire. */
export type RealtimeEnvelope = RealtimeEvent & {
  /** Unique per event; lets the client drop duplicates after a reconnect. */
  id: string;
  at: string;
};

export const REALTIME_EVENT_TYPES: RealtimeEventType[] = [
  "monitor.checked",
  "monitor.status_changed",
  "monitor.changed",
  "incident.created",
  "incident.updated",
  "incident.resolved",
  "activity.created",
  "notification.updated",
  "statuspage.changed",
];
