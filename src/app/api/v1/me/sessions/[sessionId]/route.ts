import { noContent, sessionRoute } from "@/server/http/handler";
import { revokeOwnSession } from "@/server/modules/auth/service";
import { uuidSchema } from "@/shared/schemas/common";

export const DELETE = sessionRoute({}, async ({ session, params }) => {
  await revokeOwnSession(session, uuidSchema.parse(params.sessionId));
  return noContent();
});
