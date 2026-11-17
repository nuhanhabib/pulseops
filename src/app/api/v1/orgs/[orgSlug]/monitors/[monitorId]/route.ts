import { noContent, orgRoute } from "@/server/http/handler";
import { deleteMonitor, getMonitor, updateMonitor } from "@/server/modules/monitors/service";
import { uuidSchema } from "@/shared/schemas/common";
import { updateMonitorSchema } from "@/shared/schemas/monitor";

export const GET = orgRoute({ permission: "monitor:read" }, ({ ctx, params }) => getMonitor(ctx, uuidSchema.parse(params.monitorId)));
export const PATCH = orgRoute({ permission: "monitor:write", body: updateMonitorSchema }, ({ ctx, params, body }) =>
  updateMonitor(ctx, uuidSchema.parse(params.monitorId), body),
);
export const DELETE = orgRoute({ permission: "monitor:delete" }, async ({ ctx, params }) => {
  await deleteMonitor(ctx, uuidSchema.parse(params.monitorId));
  return noContent();
});
