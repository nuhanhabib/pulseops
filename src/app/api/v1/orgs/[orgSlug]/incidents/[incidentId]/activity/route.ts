import { orgRoute } from "@/server/http/handler";
import { getIncidentActivity } from "@/server/modules/incidents/service";
import { uuidSchema } from "@/shared/schemas/common";

export const GET = orgRoute({ permission: "incident:read" }, ({ ctx, params }) => getIncidentActivity(ctx, uuidSchema.parse(params.incidentId)));
