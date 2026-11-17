import { created, orgRoute } from "@/server/http/handler";
import { createMonitor, listMonitors } from "@/server/modules/monitors/service";
import { createMonitorSchema, listMonitorsQuerySchema } from "@/shared/schemas/monitor";

export const GET = orgRoute({ permission: "monitor:read", query: listMonitorsQuerySchema }, ({ ctx, query }) => listMonitors(ctx, query));
export const POST = orgRoute({ permission: "monitor:write", body: createMonitorSchema }, async ({ ctx, body }) =>
  created(await createMonitor(ctx, body)),
);
