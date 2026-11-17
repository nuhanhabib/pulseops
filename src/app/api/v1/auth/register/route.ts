import { sessionCookie } from "@/server/auth/cookies";
import { isSecureOrigin } from "@/server/env";
import { created, publicRoute } from "@/server/http/handler";
import { register } from "@/server/modules/auth/service";
import { registerSchema } from "@/shared/schemas/auth";

export const POST = publicRoute({ body: registerSchema }, async ({ body, meta, responseHeaders }) => {
  const result = await register(body, meta);
  responseHeaders.append("Set-Cookie", sessionCookie(result.token, result.expiresAt, isSecureOrigin()));
  return created({ user: result.user, orgSlug: result.orgSlug });
});
