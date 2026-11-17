import { created, orgRoute } from "@/server/http/handler";
import { addIncidentUpdate } from "@/server/modules/incidents/service";
import { uuidSchema } from "@/shared/schemas/common";
import { createIncidentUpdateSchema } from "@/shared/schemas/incident";

export const POST = orgRoute({ permission: "incident:write", body: createIncidentUpdateSchema }, async ({ ctx, params, body }) =>
  created(await addIncidentUpdate(ctx, uuidSchema.parse(params.incidentId), body)),
);
