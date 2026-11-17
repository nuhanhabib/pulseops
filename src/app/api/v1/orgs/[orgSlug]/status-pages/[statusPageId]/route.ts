import { noContent, orgRoute } from "@/server/http/handler";
import { deleteStatusPage, getStatusPage, updateStatusPage } from "@/server/modules/status-pages/service";
import { uuidSchema } from "@/shared/schemas/common";
import { updateStatusPageSchema } from "@/shared/schemas/status-page";

export const GET = orgRoute({ permission: "statuspage:read" }, ({ ctx, params }) => getStatusPage(ctx, uuidSchema.parse(params.statusPageId)));
export const PATCH = orgRoute({ permission: "statuspage:write", body: updateStatusPageSchema }, ({ ctx, params, body }) =>
  updateStatusPage(ctx, uuidSchema.parse(params.statusPageId), body),
);
export const DELETE = orgRoute({ permission: "statuspage:write" }, async ({ ctx, params }) => {
  await deleteStatusPage(ctx, uuidSchema.parse(params.statusPageId));
  return noContent();
});
