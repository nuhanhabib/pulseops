import { sessionRoute } from "@/server/http/handler";
import { listSessions, revokeOtherSessions } from "@/server/modules/auth/service";

export const GET = sessionRoute({}, ({ session }) => listSessions(session));
/** Signs out every device except the one making the request. */
export const DELETE = sessionRoute({}, ({ session }) => revokeOtherSessions(session));
