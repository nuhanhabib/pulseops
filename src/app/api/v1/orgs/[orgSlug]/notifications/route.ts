import { orgRoute } from "@/server/http/handler";
import { getNotificationSettings } from "@/server/modules/notifications/service";

export const GET = orgRoute({ permission: "notification:read" }, ({ ctx }) => getNotificationSettings(ctx));
