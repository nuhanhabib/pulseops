import { prisma } from "@/server/db";
import { getRedis } from "@/server/redis";

/** Liveness and dependency check for load balancers. Reveals no configuration. */
export async function GET(request: Request) {
  void request.url;
  const [database, redis] = await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(() => true, () => false),
    getRedis().ping().then(() => true, () => false),
  ]);
  const healthy = database && redis;
  return Response.json({ status: healthy ? "ok" : "degraded", database, redis }, { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
