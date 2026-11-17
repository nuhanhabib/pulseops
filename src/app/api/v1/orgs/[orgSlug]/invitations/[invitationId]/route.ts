import { noContent, orgRoute } from "@/server/http/handler";
import { revokeInvitation } from "@/server/modules/organizations/service";
import { uuidSchema } from "@/shared/schemas/common";

export const DELETE = orgRoute({ permission: "member:manage" }, async ({ ctx, params }) => {
  await revokeInvitation(ctx, uuidSchema.parse(params.invitationId));
  return noContent();
});
