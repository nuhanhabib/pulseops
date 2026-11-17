import { orgRoute } from "@/server/http/handler";
import { testMonitor } from "@/server/modules/monitors/service";
import { RATE_LIMITS } from "@/server/rate-limit";
import { testMonitorSchema } from "@/shared/schemas/monitor";

export const POST = orgRoute(
  { permission: "monitor:write", body: testMonitorSchema, rateLimit: { rule: RATE_LIMITS.monitorTest, by: "user" } },
  ({ ctx, body }) => testMonitor(ctx, body),
);
