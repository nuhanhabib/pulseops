import { deleteExpiredSessions } from "@/server/auth/sessions";
import { prisma } from "@/server/db";
import { getEnv } from "@/server/env";
import { logger } from "@/server/logger";
import { rollupDailyAggregates } from "@/server/modules/metrics/queries";

const DAY_MS = 86_400_000;

/** Recomputes today's and yesterday's daily rollups from raw checks. Idempotent. */
export async function runRollup(now: Date = new Date()): Promise<number> {
  const startOfYesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - DAY_MS);
  const rows = await rollupDailyAggregates(startOfYesterday);
  logger.debug({ rows }, "daily rollup complete");
  return rows;
}

/**
 * Bounded retention. Raw checks are deleted after CHECK_RETENTION_DAYS, in
 * batches so the delete never holds a long lock. Rollups are refreshed first,
 * so nothing is pruned before it has been aggregated.
 */
export async function runRetention(now: Date = new Date()): Promise<{ checks: number; sessions: number; deliveries: number; invitations: number }> {
  const cutoff = new Date(now.getTime() - getEnv().CHECK_RETENTION_DAYS * DAY_MS);
  await rollupDailyAggregates(new Date(cutoff.getTime() - 2 * DAY_MS));

  let checks = 0;
  for (let batch = 0; batch < 200; batch++) {
    const deleted = await prisma.$executeRaw`
      DELETE FROM "MonitorCheck" WHERE id IN (SELECT id FROM "MonitorCheck" WHERE "checkedAt" < ${cutoff} LIMIT 5000)`;
    checks += deleted;
    if (deleted < 5000) break;
  }
  const sessions = await deleteExpiredSessions();
  const deliveries = (await prisma.notificationDelivery.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 90 * DAY_MS) } } })).count;
  const invitations = (await prisma.invitation.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 30 * DAY_MS) } } })).count;
  logger.info({ checks, sessions, deliveries, invitations }, "retention pass complete");
  return { checks, sessions, deliveries, invitations };
}
