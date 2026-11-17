import { Queue } from "bullmq";

import { queueConnection } from "@/server/redis";

export const QUEUE_NAMES = {
  checks: "pulseops-checks",
  notifications: "pulseops-notifications",
  maintenance: "pulseops-maintenance",
} as const;

export interface CheckJobData {
  monitorId: string;
  /** Carried so the processor can scope every query to the tenant. */
  organizationId: string;
  scheduledFor: string;
}

export interface NotificationJobData {
  deliveryId: string;
}

export type MaintenanceJobName = "rollup" | "retention";

export function createQueues() {
  const connection = queueConnection();
  return {
    checks: new Queue<CheckJobData>(QUEUE_NAMES.checks, {
      connection,
      defaultJobOptions: {
        // Retries here cover infrastructure faults (database, Redis). A target being
        // down is a successful job that recorded a DOWN result, not a job failure.
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: true,
        removeOnFail: { age: 3600, count: 500 },
      },
    }),
    notifications: new Queue<NotificationJobData>(QUEUE_NAMES.notifications, {
      connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: true,
        removeOnFail: { age: 86_400, count: 1000 },
      },
    }),
    maintenance: new Queue<Record<string, never>>(QUEUE_NAMES.maintenance, {
      connection,
      defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 10_000 }, removeOnComplete: true, removeOnFail: { count: 50 } },
    }),
  };
}

export type Queues = ReturnType<typeof createQueues>;
