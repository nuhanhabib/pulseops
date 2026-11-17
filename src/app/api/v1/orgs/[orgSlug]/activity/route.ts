import { noContent, orgRoute } from "@/server/http/handler";
import { listActivity, markActivitySeen } from "@/server/modules/activity/service";
import { cursorQuerySchema, uuidSchema } from "@/shared/schemas/common";

export const GET = orgRoute({ permission: "monitor:read", query: cursorQuerySchema.extend({ monitorId: uuidSchema.optional() }) }, ({ ctx, query }) =>
  listActivity(ctx, query),
);
/** Marks the activity inbox as read for the caller. */
export const POST = orgRoute({ permission: "monitor:read" }, async ({ ctx }) => {
  await markActivitySeen(ctx);
  return noContent();
});
