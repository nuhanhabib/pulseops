import Redis, { type RedisOptions } from "ioredis";

import { logger, serializeError } from "./logger";

/**
 * Redis connections.
 *
 * Redis is the execution plane (queues), the real-time fan-out (pub/sub), and
 * the rate-limit store. It is never the source of truth: every schedule,
 * result, and pending notification lives in Postgres, so an empty Redis loses
 * nothing durable.
 */
const globalForRedis = globalThis as unknown as { __pulseopsRedis?: Redis };

const redisUrl = () => process.env.REDIS_URL ?? "redis://localhost:6379";

function attachLogging(client: Redis, role: string): Redis {
  let lastError = "";
  client.on("error", (error) => {
    // ioredis emits the same error on every reconnect attempt; log each distinct one once.
    const message = error instanceof Error ? error.message : String(error);
    if (message === lastError) return;
    lastError = message;
    logger.warn({ role, err: serializeError(error) }, "redis connection error");
  });
  client.on("ready", () => {
    lastError = "";
  });
  return client;
}

const baseOptions: RedisOptions = {
  lazyConnect: true,
  retryStrategy: (attempt) => Math.min(attempt * 200, 3000),
};

/**
 * Shared command connection for request-path work (rate limits, publishing).
 * Commands time out quickly so an unreachable Redis degrades a request
 * instead of hanging it.
 */
export function getRedis(): Redis {
  if (!globalForRedis.__pulseopsRedis) {
    globalForRedis.__pulseopsRedis = attachLogging(
      new Redis(redisUrl(), { ...baseOptions, maxRetriesPerRequest: 2, commandTimeout: 2000 }),
      "commands",
    );
  }
  return globalForRedis.__pulseopsRedis;
}

/** A dedicated connection: a client in subscriber mode cannot run other commands. */
export function createSubscriber(): Redis {
  return attachLogging(new Redis(redisUrl(), { ...baseOptions, maxRetriesPerRequest: null }), "subscriber");
}

/**
 * Connection options for BullMQ. Workers block on Redis, which requires
 * `maxRetriesPerRequest: null`; BullMQ creates and owns the connections.
 */
export function queueConnection(): { url: string; maxRetriesPerRequest: null } {
  return { url: redisUrl(), maxRetriesPerRequest: null };
}

export async function closeRedis(): Promise<void> {
  const client = globalForRedis.__pulseopsRedis;
  globalForRedis.__pulseopsRedis = undefined;
  if (client) await client.quit().catch(() => client.disconnect());
}

export const REDIS_PREFIX = "pulseops";
export const redisKey = (...parts: (string | number)[]) => [REDIS_PREFIX, ...parts].join(":");
