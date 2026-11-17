import { created, orgRoute } from "@/server/http/handler";
import { addIncidentNote } from "@/server/modules/incidents/service";
import { uuidSchema } from "@/shared/schemas/common";
import { createIncidentNoteSchema } from "@/shared/schemas/incident";

export const POST = orgRoute({ permission: "incident:write", body: createIncidentNoteSchema }, async ({ ctx, params, body }) =>
  created(await addIncidentNote(ctx, uuidSchema.parse(params.incidentId), body)),
);
