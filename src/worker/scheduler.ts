import { prisma } from "@/server/db";
import { getEnv } from "@/server/env";
import { logger, serializeError } from "@/server/logger";

import type { Queues } from "./queues";

interface DueMonitor {
  id: string;
  organizationId: string;
}

/**
 * Claims monitors that are due and advances their `nextCheckAt` in one
 * statement.
 *
 * `FOR UPDATE SKIP LOCKED` makes this safe to run from any number of worker
 * replicas at once: each due row is claimed by exactly one of them, with no
 * leader election. The per-organization cap (`rank <= …`) is the fairness
 * control: one tenant with thousands of due monitors cannot starve the rest
 * of a tick.
 */
export async function claimDueMonitors(now: Date = new Date()): Promise<DueMonitor[]> {
  const env = getEnv();
  return prisma.$queryRaw<DueMonitor[]>`
    WITH ranked AS (
      SELECT id, row_number() OVER (PARTITION BY "organizationId" ORDER BY "nextCheckAt") AS rank
      FROM "Monitor"
      WHERE enabled = true AND "nextCheckAt" <= ${now}
    ), due AS (
      SELECT m.id FROM "Monitor" m
      JOIN ranked r ON r.id = m.id
      WHERE r.rank <= ${env.SCHEDULER_MAX_PER_ORG} AND m.enabled = true AND m."nextCheckAt" <= ${now}
      ORDER BY m."nextCheckAt"
      LIMIT ${env.SCHEDULER_BATCH_SIZE}
      FOR UPDATE OF m SKIP LOCKED
    )
    UPDATE "Monitor" m
    -- Scheduled from now, not from the missed slot: after downtime the worker resumes, it does not replay a backlog.
    SET "nextCheckAt" = ${now}::timestamptz + make_interval(secs => m."intervalSeconds")
    FROM due WHERE m.id = due.id
    RETURNING m.id, m."organizationId"`;
}

export async function schedulerTick(queues: Queues, now: Date = new Date()): Promise<number> {
  const due = await claimDueMonitors(now);
  if (due.length === 0) return 0;
  await queues.checks.addBulk(
    due.map((monitor) => ({
      name: "check",
      data: { monitorId: monitor.id, organizationId: monitor.organizationId, scheduledFor: now.toISOString() },
      // At most one job per monitor is ever waiting or running, so a slow target
      // can never have two checks in flight, however short its interval.
      opts: { deduplication: { id: monitor.id } },
    })),
  );
  return due.length;
}

/** Self-rescheduling loop: a slow tick delays the next one instead of overlapping it. */
export function startScheduler(queues: Queues): { stop: () => Promise<void> } {
  const tickMs = getEnv().SCHEDULER_TICK_MS;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> = Promise.resolve();

  const loop = () => {
    running = (async () => {
      try {
        const count = await schedulerTick(queues);
        if (count > 0) logger.debug({ count }, "scheduled checks");
      } catch (error) {
        logger.error({ err: serializeError(error) }, "scheduler tick failed");
      }
      if (!stopped) timer = setTimeout(loop, tickMs);
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
