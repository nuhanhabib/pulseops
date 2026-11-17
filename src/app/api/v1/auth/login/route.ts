import { sessionCookie } from "@/server/auth/cookies";
import { isSecureOrigin } from "@/server/env";
import { publicRoute } from "@/server/http/handler";
import { login } from "@/server/modules/auth/service";
import { loginSchema } from "@/shared/schemas/auth";

export const POST = publicRoute({ body: loginSchema }, async ({ body, meta, responseHeaders }) => {
  const result = await login(body, meta);
  responseHeaders.append("Set-Cookie", sessionCookie(result.token, result.expiresAt, isSecureOrigin()));
  return { user: result.user, orgSlug: result.orgSlug };
});
