import type { Job } from "bullmq";

import { prisma } from "@/server/db";
import { logger } from "@/server/logger";
import { performCheck } from "@/server/monitoring/http-check";
import { applyCheckResult } from "@/server/monitoring/process-result";

import type { CheckJobData } from "../queues";

export async function processCheckJob(job: Job<CheckJobData>): Promise<{ status: string } | { skipped: string }> {
  const { monitorId, organizationId } = job.data;
  const monitor = await prisma.monitor.findFirst({
    where: { id: monitorId, organizationId },
    select: {
      url: true, method: true, timeoutMs: true, expectedStatusCodes: true, followRedirects: true, retries: true,
      degradedThresholdMs: true, enabled: true,
    },
  });
  // Deleted or paused between scheduling and execution.
  if (!monitor) return { skipped: "not_found" };
  if (!monitor.enabled) return { skipped: "paused" };

  const outcome = await performCheck(monitor);
  const result = await applyCheckResult(monitorId, organizationId, outcome, new Date());
  if (result.transition) {
    logger.info({ monitorId, organizationId, transition: result.transition, status: result.status, incidentId: result.incidentId }, "monitor state transition");
  }
  return { status: outcome.status };
}
