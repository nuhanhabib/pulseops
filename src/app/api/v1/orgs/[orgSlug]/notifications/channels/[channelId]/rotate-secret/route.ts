import { orgRoute } from "@/server/http/handler";
import { rotateChannelSecret } from "@/server/modules/notifications/service";
import { uuidSchema } from "@/shared/schemas/common";

export const POST = orgRoute({ permission: "notification:manage" }, ({ ctx, params }) =>
  rotateChannelSecret(ctx, uuidSchema.parse(params.channelId)),
);
