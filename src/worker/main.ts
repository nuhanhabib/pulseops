import "./service-name";
import "@/server/load-env";

import http from "node:http";

import { Worker } from "bullmq";

import { prisma } from "@/server/db";
import { EnvValidationError, getEnv } from "@/server/env";
import { logger, serializeError } from "@/server/logger";
import { closeRedis, queueConnection } from "@/server/redis";

import { startOutbox } from "./outbox";
import { processCheckJob } from "./processors/check";
import { runRetention, runRollup } from "./processors/maintenance";
import { processNotificationJob } from "./processors/notification";
import { createQueues, QUEUE_NAMES } from "./queues";
import { startScheduler } from "./scheduler";

/**
 * The PulseOps worker: a long-running process, separate from the web app.
 *
 * It owns everything that happens on a clock: claiming due monitors,
 * executing checks, the outage state machine, notification delivery, rollups,
 * and retention. Run at least one; run several for throughput or redundancy.
 */
async function main() {
  let env;
  try {
    env = getEnv();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  await prisma.$queryRaw`SELECT 1`;
  const queues = createQueues();
  const connection = queueConnection();

  const checkWorker = new Worker(QUEUE_NAMES.checks, processCheckJob, {
    connection, concurrency: env.WORKER_CONCURRENCY,
    // A check can legitimately take timeout × attempts; do not declare it stalled before that.
    lockDuration: 150_000,
  });
  const notificationWorker = new Worker(QUEUE_NAMES.notifications, processNotificationJob, { connection, concurrency: 5 });
  const maintenanceWorker = new Worker(
    QUEUE_NAMES.maintenance,
    async (job) => (job.name === "retention" ? runRetention() : runRollup()),
    { connection, concurrency: 1 },
  );

  for (const [name, worker] of Object.entries({ checks: checkWorker, notifications: notificationWorker, maintenance: maintenanceWorker })) {
    worker.on("failed", (job, error) => logger.warn({ queue: name, jobId: job?.id, attempt: job?.attemptsMade, err: serializeError(error) }, "job failed"));
    worker.on("error", (error) => logger.error({ queue: name, err: serializeError(error) }, "worker error"));
  }

  // Recurring maintenance, registered idempotently so replicas do not duplicate it.
  await queues.maintenance.upsertJobScheduler("rollup", { every: 5 * 60_000 }, { name: "rollup" });
  await queues.maintenance.upsertJobScheduler("retention", { every: 60 * 60_000 }, { name: "retention" });

  const scheduler = startScheduler(queues);
  const outbox = startOutbox(queues);

  let healthServer: http.Server | undefined;
  if (env.WORKER_HEALTH_PORT > 0) {
    healthServer = http
      .createServer((request, response) => {
        if (request.url !== "/healthz") return void response.writeHead(404).end();
        Promise.all([prisma.$queryRaw`SELECT 1`, queues.checks.getJobCounts("waiting", "active", "failed")])
          .then(([, counts]) => response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ status: "ok", checks: counts })))
          .catch(() => response.writeHead(503, { "Content-Type": "application/json" }).end(JSON.stringify({ status: "unavailable" })));
      })
      .listen(env.WORKER_HEALTH_PORT);
  }

  logger.info({ concurrency: env.WORKER_CONCURRENCY, tickMs: env.SCHEDULER_TICK_MS, healthPort: env.WORKER_HEALTH_PORT || null }, "worker started");

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "worker shutting down");
    // Stop taking new work first, then let in-flight jobs finish.
    await Promise.all([scheduler.stop(), outbox.stop()]);
    await Promise.all([checkWorker.close(), notificationWorker.close(), maintenanceWorker.close()]);
    await Promise.all(Object.values(queues).map((queue) => queue.close()));
    healthServer?.close();
    await closeRedis();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error) => {
  logger.fatal({ err: serializeError(error) }, "worker failed to start");
  process.exit(1);
});
