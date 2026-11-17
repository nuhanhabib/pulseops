import { z } from "zod";

import { noContent, orgRoute } from "@/server/http/handler";
import { deleteOrganization, getOrganization, updateOrganization } from "@/server/modules/organizations/service";
import { permissionsFor } from "@/shared/permissions";
import { updateOrganizationSchema } from "@/shared/schemas/organization";

export const GET = orgRoute({ permission: "org:read" }, async ({ ctx }) => ({
  organization: await getOrganization(ctx),
  role: ctx.role,
  permissions: permissionsFor(ctx.role),
}));
export const PATCH = orgRoute({ permission: "org:update", body: updateOrganizationSchema }, ({ ctx, body }) => updateOrganization(ctx, body));
export const DELETE = orgRoute({ permission: "org:delete", body: z.object({ confirm: z.string() }) }, async ({ ctx, body }) => {
  await deleteOrganization(ctx, body.confirm);
  return noContent();
});
