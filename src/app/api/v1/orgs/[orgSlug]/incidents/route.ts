import { created, orgRoute } from "@/server/http/handler";
import { createIncident, listIncidents } from "@/server/modules/incidents/service";
import { createIncidentSchema, listIncidentsQuerySchema } from "@/shared/schemas/incident";

export const GET = orgRoute({ permission: "incident:read", query: listIncidentsQuerySchema }, ({ ctx, query }) => listIncidents(ctx, query));
export const POST = orgRoute({ permission: "incident:write", body: createIncidentSchema }, async ({ ctx, body }) =>
  created(await createIncident(ctx, body)),
);
