import { noContent, orgRoute } from "@/server/http/handler";
import { removeMember, updateMemberRole } from "@/server/modules/organizations/service";
import { uuidSchema } from "@/shared/schemas/common";
import { updateMemberRoleSchema } from "@/shared/schemas/organization";

export const PATCH = orgRoute({ permission: "member:manage", body: updateMemberRoleSchema }, ({ ctx, params, body }) =>
  updateMemberRole(ctx, uuidSchema.parse(params.memberId), body.role),
);
// `member:read` only: any member may remove themselves. Removing others is checked in the service.
export const DELETE = orgRoute({ permission: "member:read" }, async ({ ctx, params }) => {
  await removeMember(ctx, uuidSchema.parse(params.memberId));
  return noContent();
});
