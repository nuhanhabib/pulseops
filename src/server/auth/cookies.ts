import { SESSION_COOKIE } from "@/shared/constants";

/**
 * Cookie handling without a framework dependency, so the same code serves
 * route handlers, server components, and tests that call handlers directly.
 */

export function parseCookies(header: string | null | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    if (!name || name in cookies) continue;
    const raw = part.slice(separator + 1).trim();
    try {
      cookies[name] = decodeURIComponent(raw);
    } catch {
      cookies[name] = raw;
    }
  }
  return cookies;
}

export function readSessionToken(cookieHeader: string | null | undefined): string | null {
  const token = parseCookies(cookieHeader)[SESSION_COOKIE];
  // Tokens are 32 random bytes in base64url; reject anything else before it reaches the database.
  return token && /^[A-Za-z0-9_-]{40,64}$/.test(token) ? token : null;
}

interface CookieAttributes {
  expires?: Date;
  maxAgeSeconds?: number;
  httpOnly?: boolean;
  secure: boolean;
}

function serializeCookie(name: string, value: string, attributes: CookieAttributes): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "SameSite=Lax"];
  if (attributes.httpOnly !== false) parts.push("HttpOnly");
  if (attributes.secure) parts.push("Secure");
  if (attributes.expires) parts.push(`Expires=${attributes.expires.toUTCString()}`);
  if (attributes.maxAgeSeconds !== undefined) parts.push(`Max-Age=${attributes.maxAgeSeconds}`);
  return parts.join("; ");
}

/**
 * HttpOnly keeps the token away from scripts, SameSite=Lax keeps it off
 * cross-site subrequests, and Secure is set whenever the app is served over
 * HTTPS (it is omitted on plain-HTTP localhost so development works in every
 * browser).
 */
export function sessionCookie(token: string, expiresAt: Date, secure: boolean): string {
  return serializeCookie(SESSION_COOKIE, token, { expires: expiresAt, secure });
}

export function clearedSessionCookie(secure: boolean): string {
  return serializeCookie(SESSION_COOKIE, "", { expires: new Date(0), maxAgeSeconds: 0, secure });
}

/** Non-sensitive preference cookie (last opened workspace). */
export function preferenceCookie(name: string, value: string, secure: boolean): string {
  return serializeCookie(name, value, { maxAgeSeconds: 60 * 60 * 24 * 365, secure });
}
