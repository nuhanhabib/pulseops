import { orgRoute } from "@/server/http/handler";
import { requestCheckNow } from "@/server/modules/monitors/service";
import { uuidSchema } from "@/shared/schemas/common";

export const POST = orgRoute({ permission: "monitor:write" }, ({ ctx, params }) => requestCheckNow(ctx, uuidSchema.parse(params.monitorId)));
