import { NotificationChannelType, type NotificationEvent } from "@/shared/enums";

import type { DbClient, Prisma } from "../../db";

/**
 * Transactional outbox.
 *
 * Call this with the same transaction client as the state change that caused
 * the notification. The delivery rows commit atomically with that change, so
 * a crash can never produce "incident opened, nobody told" or the reverse.
 * The worker picks pending rows up and delivers them with retries.
 */

export interface NotificationPayload {
  /** Shown as the email heading and sent as `summary` in webhooks. */
  headline: string;
  /** Short key/value facts rendered as a table in email. */
  facts: { label: string; value: string }[];
  /** Path within the app; the worker prefixes APP_URL. */
  path: string;
  organization: { name: string; slug: string };
  monitor?: { id: string; name: string; url: string } | null;
  incident?: { id: string; number: number; title: string; severity: string; status: string } | null;
  occurredAt: string;
}

export interface NotificationRequest {
  organizationId: string;
  event: NotificationEvent;
  /**
   * Identifies the occurrence, e.g. `monitor.down:<monitorId>:<timestamp>`.
   * Combined with the recipient it forms the idempotency key, so re-processing
   * the same occurrence never notifies anyone twice.
   */
  occurrenceKey: string;
  subject: string;
  payload: NotificationPayload;
  incidentId?: string | null;
  monitorId?: string | null;
}

const PREFERENCE_FIELD = {
  INCIDENT_CREATED: "notifyIncidentCreated",
  INCIDENT_RESOLVED: "notifyIncidentResolved",
  MONITOR_DOWN: "notifyMonitorDown",
  MONITOR_RECOVERED: "notifyMonitorRecovered",
} as const satisfies Record<NotificationEvent, string>;

export async function enqueueNotifications(db: DbClient, request: NotificationRequest): Promise<number> {
  const [members, channels] = await Promise.all([
    db.organizationMember.findMany({
      where: { organizationId: request.organizationId, [PREFERENCE_FIELD[request.event]]: true },
      select: { userId: true, user: { select: { email: true } } },
    }),
    db.notificationChannel.findMany({
      where: { organizationId: request.organizationId, enabled: true, events: { has: request.event } },
      select: { id: true, type: true, config: true },
    }),
  ]);

  const base = {
    organizationId: request.organizationId,
    event: request.event,
    subject: request.subject.slice(0, 200),
    payload: request.payload as unknown as Prisma.InputJsonValue,
    incidentId: request.incidentId ?? null,
    monitorId: request.monitorId ?? null,
  };

  const rows: Prisma.NotificationDeliveryCreateManyInput[] = [];
  const emailed = new Set<string>();

  for (const member of members) {
    emailed.add(member.user.email);
    rows.push({
      ...base,
      userId: member.userId,
      channelType: NotificationChannelType.EMAIL,
      recipient: member.user.email,
      dedupeKey: `${request.occurrenceKey}:user:${member.userId}`,
    });
  }

  for (const channel of channels) {
    const config = (channel.config ?? {}) as { recipients?: unknown; url?: unknown };
    if (channel.type === NotificationChannelType.EMAIL) {
      const recipients = Array.isArray(config.recipients) ? config.recipients.filter((item): item is string => typeof item === "string") : [];
      for (const recipient of recipients) {
        // Someone who is both a member and on a distribution list gets one email.
        if (emailed.has(recipient)) continue;
        emailed.add(recipient);
        rows.push({
          ...base,
          channelId: channel.id,
          channelType: NotificationChannelType.EMAIL,
          recipient,
          dedupeKey: `${request.occurrenceKey}:channel:${channel.id}:${recipient}`,
        });
      }
    } else if (typeof config.url === "string") {
      rows.push({
        ...base,
        channelId: channel.id,
        channelType: NotificationChannelType.WEBHOOK,
        recipient: config.url,
        dedupeKey: `${request.occurrenceKey}:channel:${channel.id}`,
      });
    }
  }

  if (rows.length === 0) return 0;
  const result = await db.notificationDelivery.createMany({ data: rows, skipDuplicates: true });
  return result.count;
}
