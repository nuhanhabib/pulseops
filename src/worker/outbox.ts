import { prisma } from "@/server/db";
import { logger, serializeError } from "@/server/logger";
import { DeliveryStatus } from "@/shared/enums";

import type { Queues } from "./queues";

/**
 * Moves pending outbox rows onto the delivery queue. The job id is the row
 * id, so enqueueing the same row on every tick until it leaves PENDING is
 * harmless: BullMQ ignores an id that is already queued or running.
 */
export async function drainOutbox(queues: Queues): Promise<number> {
  const pending = await prisma.notificationDelivery.findMany({
    where: { status: DeliveryStatus.PENDING, createdAt: { gt: new Date(Date.now() - 86_400_000) } },
    orderBy: { createdAt: "asc" }, take: 200, select: { id: true },
  });
  if (pending.length === 0) return 0;
  await queues.notifications.addBulk(pending.map((row) => ({ name: "deliver", data: { deliveryId: row.id }, opts: { jobId: row.id } })));
  return pending.length;
}

export function startOutbox(queues: Queues, intervalMs = 3000): { stop: () => Promise<void> } {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> = Promise.resolve();
  const loop = () => {
    running = (async () => {
      try {
        await drainOutbox(queues);
      } catch (error) {
        logger.error({ err: serializeError(error) }, "outbox drain failed");
      }
      if (!stopped) timer = setTimeout(loop, intervalMs);
    })();
  };
  loop();
  return {
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      await running;
    },
  };
}
