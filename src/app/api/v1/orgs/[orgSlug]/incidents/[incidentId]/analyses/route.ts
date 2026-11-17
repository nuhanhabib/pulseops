import { created, orgRoute } from "@/server/http/handler";
import { analyzeIncident, listAnalyses } from "@/server/modules/ai/service";
import { uuidSchema } from "@/shared/schemas/common";

export const GET = orgRoute({ permission: "incident:read" }, ({ ctx, params }) => listAnalyses(ctx, uuidSchema.parse(params.incidentId)));
export const POST = orgRoute({ permission: "ai:use" }, async ({ ctx, params }) =>
  created(await analyzeIncident(ctx, uuidSchema.parse(params.incidentId))),
);
