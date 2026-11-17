import { PrismaPg } from "@prisma/adapter-pg";

import { Prisma, PrismaClient } from "@/generated/prisma/client";

/**
 * One Prisma client per process.
 *
 * In development Next.js re-evaluates modules on every edit; without the
 * `globalThis` cache each reload would open a fresh connection pool and
 * exhaust Postgres within minutes.
 *
 * The client is constructed eagerly but connects lazily, so importing this
 * module (for example during `next build`) never needs a reachable database.
 */
const globalForPrisma = globalThis as unknown as { __pulseopsPrisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    // Fail fast instead of hanging a request when the pool is exhausted.
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient = globalForPrisma.__pulseopsPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__pulseopsPrisma = prisma;
}

/** Either the root client or an interactive-transaction client. */
export type DbClient = PrismaClient | Prisma.TransactionClient;

export { Prisma };

/** True for Prisma's "unique constraint failed" error, optionally on a given field. */
export function isUniqueViolation(error: unknown, field?: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  if (!field) return true;
  return JSON.stringify(error.meta ?? {}).includes(field);
}

export function isRecordNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
}

/** Postgres aborts one side of a deadlock or a serialization conflict; both are safe to retry. */
export function isRetryableTransactionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code === "P2034";
  const code = (error as { code?: unknown } | null)?.code;
  return code === "40001" || code === "40P01";
}
