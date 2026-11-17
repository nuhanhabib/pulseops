import { orgRoute } from "@/server/http/handler";
import { setIncidentMonitors } from "@/server/modules/incidents/service";
import { uuidSchema } from "@/shared/schemas/common";
import { setIncidentMonitorsSchema } from "@/shared/schemas/incident";

export const PUT = orgRoute({ permission: "incident:write", body: setIncidentMonitorsSchema }, ({ ctx, params, body }) =>
  setIncidentMonitors(ctx, uuidSchema.parse(params.incidentId), body.monitorIds),
);
