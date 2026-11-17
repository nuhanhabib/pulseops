import { afterAll, beforeEach } from "vitest";

import { applyTestEnv } from "./test-env";

applyTestEnv();

beforeEach(async () => {
  const { prisma } = await import("@/server/db");
  const { getRedis } = await import("@/server/redis");
  // Organizations and users own everything else through cascades.
  await prisma.$executeRawUnsafe('TRUNCATE "Organization", "User" CASCADE');
  await getRedis().flushdb();
});

afterAll(async () => {
  const { prisma } = await import("@/server/db");
  const { closeRedis } = await import("@/server/redis");
  await closeRedis();
  await prisma.$disconnect();
});
