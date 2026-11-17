import { sessionRoute } from "@/server/http/handler";
import { changePassword } from "@/server/modules/auth/service";
import { changePasswordSchema } from "@/shared/schemas/auth";

export const POST = sessionRoute({ body: changePasswordSchema }, ({ session, body }) => changePassword(session, body));
