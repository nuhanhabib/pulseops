import { prisma } from "../db";
import { getEnv } from "../env";
import { generateToken, hashToken } from "./tokens";

/**
 * Server-side sessions.
 *
 * The browser holds an opaque random token; the database holds only its
 * SHA-256 hash. Because the session is a row and not a signed blob, signing
 * out, changing a password, or removing a device takes effect immediately.
 */

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
}

export interface AuthSession {
  sessionId: string;
  user: SessionUser;
  expiresAt: Date;
  /** Set when the expiry was just extended and the cookie should be re-issued. */
  refreshed: boolean;
}

export interface SessionMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

const DAY_MS = 86_400_000;
/** `lastUsedAt` is written at most this often, so reads do not become writes. */
const TOUCH_INTERVAL_MS = 5 * 60_000;

const sessionTtlMs = () => getEnv().SESSION_TTL_DAYS * DAY_MS;

export async function createSession(
  userId: string,
  meta: SessionMeta = {},
): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + sessionTtlMs());
  const session = await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent?.slice(0, 400) ?? null,
    },
    select: { id: true },
  });
  return { token, sessionId: session.id, expiresAt };
}

/**
 * Resolves a cookie token to a session, or null. Expired sessions are deleted
 * on sight. Active sessions slide: once less than half the lifetime remains,
 * the expiry is pushed out to a full lifetime again.
 */
export async function validateSessionToken(token: string | null | undefined): Promise<AuthSession | null> {
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      expiresAt: true,
      lastUsedAt: true,
      user: { select: { id: true, email: true, name: true, createdAt: true } },
    },
  });
  if (!session) return null;

  const now = Date.now();
  if (session.expiresAt.getTime() <= now) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }

  let expiresAt = session.expiresAt;
  let refreshed = false;
  const shouldExtend = session.expiresAt.getTime() - now < sessionTtlMs() / 2;
  const shouldTouch = now - session.lastUsedAt.getTime() > TOUCH_INTERVAL_MS;

  if (shouldExtend || shouldTouch) {
    if (shouldExtend) {
      expiresAt = new Date(now + sessionTtlMs());
      refreshed = true;
    }
    // updateMany: a concurrent sign-out may have removed the row; that is not an error.
    await prisma.session.updateMany({
      where: { id: session.id },
      data: { lastUsedAt: new Date(now), ...(shouldExtend ? { expiresAt } : {}) },
    });
  }

  return { sessionId: session.id, user: session.user, expiresAt, refreshed };
}

export async function revokeSession(sessionId: string, userId: string): Promise<boolean> {
  const result = await prisma.session.deleteMany({ where: { id: sessionId, userId } });
  return result.count > 0;
}

/** Signs a user out everywhere, optionally keeping the session making the request. */
export async function revokeAllSessions(userId: string, exceptSessionId?: string): Promise<number> {
  const result = await prisma.session.deleteMany({
    where: { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
  });
  return result.count;
}

export async function deleteExpiredSessions(): Promise<number> {
  const result = await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return result.count;
}

/** "Chrome on macOS" from a User-Agent string. Best effort, display only. */
export function describeUserAgent(userAgent: string | null | undefined): string {
  if (!userAgent) return "Unknown device";
  const browser =
    /Edg\//.test(userAgent) ? "Edge"
    : /OPR\/|Opera/.test(userAgent) ? "Opera"
    : /Firefox\//.test(userAgent) ? "Firefox"
    : /Chrome\//.test(userAgent) ? "Chrome"
    : /Safari\//.test(userAgent) ? "Safari"
    : /curl\//i.test(userAgent) ? "curl"
    : /node|undici/i.test(userAgent) ? "Node.js"
    : "Unknown browser";
  const os =
    /Windows/.test(userAgent) ? "Windows"
    : /iPhone|iPad|iOS/.test(userAgent) ? "iOS"
    : /Mac OS X|Macintosh/.test(userAgent) ? "macOS"
    : /Android/.test(userAgent) ? "Android"
    : /Linux/.test(userAgent) ? "Linux"
    : null;
  return os ? `${browser} on ${os}` : browser;
}
