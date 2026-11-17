import { orgRoute } from "@/server/http/handler";
import { listDeliveries } from "@/server/modules/notifications/service";
import { listDeliveriesQuerySchema } from "@/shared/schemas/notification";

export const GET = orgRoute({ permission: "notification:read", query: listDeliveriesQuerySchema }, ({ ctx, query }) => listDeliveries(ctx, query));
