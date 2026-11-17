import { sessionRoute } from "@/server/http/handler";
import { getMe, updateProfile } from "@/server/modules/auth/service";
import { updateProfileSchema } from "@/shared/schemas/auth";

export const GET = sessionRoute({}, ({ session }) => getMe(session));
export const PATCH = sessionRoute({ body: updateProfileSchema }, ({ session, body }) => updateProfile(session, body));
