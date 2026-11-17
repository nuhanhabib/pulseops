import { orgRoute } from "@/server/http/handler";
import { listChecks } from "@/server/modules/monitors/service";
import { uuidSchema } from "@/shared/schemas/common";
import { listChecksQuerySchema } from "@/shared/schemas/monitor";

export const GET = orgRoute({ permission: "monitor:read", query: listChecksQuerySchema }, ({ ctx, params, query }) =>
  listChecks(ctx, uuidSchema.parse(params.monitorId), query),
);
