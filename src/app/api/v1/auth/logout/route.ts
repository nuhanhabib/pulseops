import { clearedSessionCookie } from "@/server/auth/cookies";
import { isSecureOrigin } from "@/server/env";
import { noContent, sessionRoute } from "@/server/http/handler";
import { logout } from "@/server/modules/auth/service";

export const POST = sessionRoute({}, async ({ session, responseHeaders }) => {
  await logout(session);
  responseHeaders.append("Set-Cookie", clearedSessionCookie(isSecureOrigin()));
  return noContent();
});
