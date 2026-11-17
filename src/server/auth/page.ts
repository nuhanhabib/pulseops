import { cookies } from "next/headers";
import { cache } from "react";

import { SESSION_COOKIE } from "@/shared/constants";

import { type AuthSession, validateSessionToken } from "./sessions";

/**
 * The current session for server components. Memoized per request, so a
 * layout and the page under it share one database lookup. Reads a cookie, so
 * callers must sit inside a <Suspense> boundary (Cache Components).
 */
export const getPageSession = cache(async (): Promise<AuthSession | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return validateSessionToken(token);
});
