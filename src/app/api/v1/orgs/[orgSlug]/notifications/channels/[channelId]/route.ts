import { noContent, orgRoute } from "@/server/http/handler";
import { deleteChannel, updateChannel } from "@/server/modules/notifications/service";
import { uuidSchema } from "@/shared/schemas/common";
import { updateChannelSchema } from "@/shared/schemas/notification";

export const PATCH = orgRoute({ permission: "notification:manage", body: updateChannelSchema }, ({ ctx, params, body }) =>
  updateChannel(ctx, uuidSchema.parse(params.channelId), body),
);
export const DELETE = orgRoute({ permission: "notification:manage" }, async ({ ctx, params }) => {
  await deleteChannel(ctx, uuidSchema.parse(params.channelId));
  return noContent();
});
