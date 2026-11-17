import { z } from "zod";

import { orgRoute } from "@/server/http/handler";
import { getMonitorAvailability, getMonitorStats } from "@/server/modules/monitors/service";
import { timeRangeSchema, uuidSchema } from "@/shared/schemas/common";

export const GET = orgRoute({ permission: "monitor:read", query: z.object({ range: timeRangeSchema }) }, async ({ ctx, params, query }) => {
  const monitorId = uuidSchema.parse(params.monitorId);
  const [stats, availability] = await Promise.all([getMonitorStats(ctx, monitorId, query.range), getMonitorAvailability(ctx, monitorId, 90)]);
  return { stats, availability };
});
