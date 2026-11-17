import { created, orgRoute } from "@/server/http/handler";
import { createChannel } from "@/server/modules/notifications/service";
import { createChannelSchema } from "@/shared/schemas/notification";

export const POST = orgRoute({ permission: "notification:manage", body: createChannelSchema }, async ({ ctx, body }) =>
  created(await createChannel(ctx, body)),
);
