import { noContent, orgRoute } from "@/server/http/handler";
import { deleteIncident, getIncident, updateIncident } from "@/server/modules/incidents/service";
import { uuidSchema } from "@/shared/schemas/common";
import { updateIncidentSchema } from "@/shared/schemas/incident";

export const GET = orgRoute({ permission: "incident:read" }, ({ ctx, params }) => getIncident(ctx, uuidSchema.parse(params.incidentId)));
export const PATCH = orgRoute({ permission: "incident:write", body: updateIncidentSchema }, ({ ctx, params, body }) =>
  updateIncident(ctx, uuidSchema.parse(params.incidentId), body),
);
export const DELETE = orgRoute({ permission: "incident:delete" }, async ({ ctx, params }) => {
  await deleteIncident(ctx, uuidSchema.parse(params.incidentId));
  return noContent();
});
