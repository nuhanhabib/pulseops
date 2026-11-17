import { randomUUID } from "node:crypto";

import type { RealtimeEnvelope, RealtimeEvent } from "@/shared/realtime";

import { logger, serializeError } from "../logger";
import { getRedis, redisKey } from "../redis";

export const orgChannel = (organizationId: string) => redisKey("events", "org", organizationId);

/**
 * Publishes an event to everyone watching an organization.
 *
 * Call it *after* the database transaction commits, never inside it: a
 * subscriber that refetches on the event must be able to see the change.
 * Publishing is best effort by design. Events are refresh hints, so a lost
 * one costs freshness until the next poll, not correctness.
 */
export async function publish(organizationId: string, ...events: RealtimeEvent[]): Promise<void> {
  if (events.length === 0) return;
  try {
    const redis = getRedis();
    const channel = orgChannel(organizationId);
    const at = new Date().toISOString();
    await Promise.all(
      events.map((event) => {
        const envelope: RealtimeEnvelope = { ...event, id: randomUUID(), at };
        return redis.publish(channel, JSON.stringify(envelope));
      }),
    );
  } catch (error) {
    logger.warn({ organizationId, err: serializeError(error) }, "failed to publish realtime event");
  }
}
