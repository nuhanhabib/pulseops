import { type NextRequest, NextResponse } from "next/server";

import { LAST_ORG_COOKIE, SESSION_COOKIE } from "@/shared/constants";

/**
 * Optimistic routing only. This looks at whether a session cookie is present
 * to save signed-out visitors a round trip; it does not validate the session
 * and is not an authorization boundary. Real checks happen on the server in
 * the organization layout and in every API handler.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = request.cookies.has(SESSION_COOKIE);

  if (pathname.startsWith("/org")) {
    if (!hasSession) {
      const url = request.nextUrl.clone();
      url.pathname = "/sign-in";
      url.search = `?next=${encodeURIComponent(pathname + search)}`;
      return NextResponse.redirect(url);
    }
    // Remember the workspace so /org can send the user back to it next time.
    const slug = /^\/org\/([a-z0-9-]+)\//.exec(pathname)?.[1];
    if (slug && slug !== "new" && request.cookies.get(LAST_ORG_COOKIE)?.value !== slug) {
      const response = NextResponse.next();
      response.cookies.set(LAST_ORG_COOKIE, slug, { path: "/", maxAge: 31_536_000, sameSite: "lax", httpOnly: true, secure: request.nextUrl.protocol === "https:" });
      return response;
    }
  }

  if (hasSession && (pathname === "/sign-in" || pathname === "/sign-up") && !request.nextUrl.searchParams.has("next")) {
    return NextResponse.redirect(new URL("/org", request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/org/:path*", "/sign-in", "/sign-up"] };
