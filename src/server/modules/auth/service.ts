import type { ChangePasswordInput, LoginInput, RegisterInput, UpdateProfileInput } from "@/shared/schemas/auth";
import type { MeDto, SessionDto } from "@/shared/types";

import { hashPassword, needsRehash, verifyAgainstDummy, verifyPassword } from "../../auth/password";
import { type AuthSession, createSession, describeUserAgent, revokeAllSessions, revokeSession, type SessionMeta } from "../../auth/sessions";
import { isUniqueViolation, prisma } from "../../db";
import { getEnv } from "../../env";
import { AppError, conflict, fieldError, forbidden, notFound } from "../../errors";
import { enforceRateLimit, RATE_LIMITS, resetRateLimit } from "../../rate-limit";
import type { RequestMeta } from "../../tenancy";
import { iso } from "../mappers";
import { acceptInvitation, createOrganizationFor, listMemberships } from "../organizations/service";

export interface AuthResult {
  token: string;
  expiresAt: Date;
  user: { id: string; email: string; name: string };
  /** Where to send the browser next. */
  orgSlug: string | null;
}

const sessionMeta = (meta: RequestMeta): SessionMeta => ({ ipAddress: meta.ipAddress, userAgent: meta.userAgent });

export async function register(input: RegisterInput, meta: RequestMeta): Promise<AuthResult> {
  await enforceRateLimit(RATE_LIMITS.registerByIp, meta.ipAddress ?? "unknown");
  // Invitations still work on a closed instance: that is how a private deployment adds people.
  if (!getEnv().ALLOW_SIGNUP && !input.invitationToken) {
    throw forbidden("Sign-ups are disabled on this instance. Ask an administrator for an invitation.");
  }

  const passwordHash = await hashPassword(input.password);
  try {
    const { user, orgSlug } = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: input.email, name: input.name, passwordHash, lastLoginAt: new Date() },
        select: { id: true, email: true, name: true },
      });
      const actor = { userId: user.id, email: user.email, name: user.name };
      if (input.invitationToken) {
        const accepted = await acceptInvitation(tx, actor, input.invitationToken, meta);
        return { user, orgSlug: accepted.orgSlug };
      }
      const org = await createOrganizationFor(tx, actor, { name: input.organizationName }, meta);
      return { user, orgSlug: org.slug };
    });
    const session = await createSession(user.id, sessionMeta(meta));
    return { token: session.token, expiresAt: session.expiresAt, user, orgSlug };
  } catch (error) {
    if (isUniqueViolation(error, "email")) {
      // Sign-up necessarily reveals that an address is taken; the limit above bounds enumeration.
      throw conflict("An account with that email already exists.", { email: ["An account with that email already exists. Sign in instead."] });
    }
    throw error;
  }
}

const INVALID_CREDENTIALS = "Incorrect email or password.";

export async function login(input: LoginInput, meta: RequestMeta): Promise<AuthResult> {
  // Both limits are checked before any password work, so a locked-out attacker cannot burn CPU either.
  await enforceRateLimit(RATE_LIMITS.loginByIp, meta.ipAddress ?? "unknown", "Too many sign-in attempts. Try again in a few minutes.");
  await enforceRateLimit(RATE_LIMITS.loginByAccount, input.email, "Too many sign-in attempts for this account. Try again in a few minutes.");

  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, email: true, name: true, passwordHash: true },
  });
  const valid = user ? await verifyPassword(user.passwordHash, input.password) : await verifyAgainstDummy(input.password);
  // One message for "no such account" and "wrong password".
  if (!user || !valid) throw new AppError("unauthenticated", INVALID_CREDENTIALS);

  await resetRateLimit(RATE_LIMITS.loginByAccount, input.email);
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), ...(needsRehash(user.passwordHash) ? { passwordHash: await hashPassword(input.password) } : {}) },
  });
  const session = await createSession(user.id, sessionMeta(meta));
  const memberships = await prisma.organizationMember.findFirst({
    where: { userId: user.id }, orderBy: { createdAt: "asc" }, select: { organization: { select: { slug: true } } },
  });
  return {
    token: session.token, expiresAt: session.expiresAt,
    user: { id: user.id, email: user.email, name: user.name },
    orgSlug: memberships?.organization.slug ?? null,
  };
}

export async function logout(session: AuthSession): Promise<void> {
  await revokeSession(session.sessionId, session.user.id);
}

export async function getMe(session: AuthSession): Promise<MeDto> {
  return {
    user: { id: session.user.id, email: session.user.email, name: session.user.name, createdAt: iso(session.user.createdAt) },
    memberships: await listMemberships(session.user.id),
  };
}

export async function updateProfile(session: AuthSession, input: UpdateProfileInput): Promise<MeDto["user"]> {
  const user = await prisma.user.update({
    where: { id: session.user.id }, data: { name: input.name }, select: { id: true, email: true, name: true, createdAt: true },
  });
  return { ...user, createdAt: iso(user.createdAt) };
}

/** Verifies the current password, then signs out every other device. */
export async function changePassword(session: AuthSession, input: ChangePasswordInput): Promise<{ revokedSessions: number }> {
  await enforceRateLimit(RATE_LIMITS.passwordChange, session.user.id);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id }, select: { passwordHash: true, email: true } });
  if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
    throw fieldError("currentPassword", "That is not your current password.");
  }
  if (input.newPassword.toLowerCase() === user.email) throw fieldError("newPassword", "Your password cannot be your email address.");
  await prisma.user.update({ where: { id: session.user.id }, data: { passwordHash: await hashPassword(input.newPassword) } });
  return { revokedSessions: await revokeAllSessions(session.user.id, session.sessionId) };
}

export async function listSessions(session: AuthSession): Promise<SessionDto[]> {
  const rows = await prisma.session.findMany({
    where: { userId: session.user.id, expiresAt: { gt: new Date() } },
    orderBy: { lastUsedAt: "desc" },
    select: { id: true, createdAt: true, lastUsedAt: true, expiresAt: true, ipAddress: true, userAgent: true },
  });
  return rows.map((row) => ({
    id: row.id, current: row.id === session.sessionId, createdAt: iso(row.createdAt), lastUsedAt: iso(row.lastUsedAt),
    expiresAt: iso(row.expiresAt), ipAddress: row.ipAddress, device: describeUserAgent(row.userAgent),
  }));
}

export async function revokeOwnSession(session: AuthSession, sessionId: string): Promise<void> {
  if (!(await revokeSession(sessionId, session.user.id))) throw notFound("Session");
}

export async function revokeOtherSessions(session: AuthSession): Promise<{ revokedSessions: number }> {
  return { revokedSessions: await revokeAllSessions(session.user.id, session.sessionId) };
}
