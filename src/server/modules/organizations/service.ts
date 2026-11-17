import { INVITATION_TTL_DAYS, RESERVED_SLUGS } from "@/shared/constants";
import { OrgRole } from "@/shared/enums";
import { canManageRole } from "@/shared/permissions";
import { routes } from "@/shared/routes";
import {
  type CreateInvitationInput, type CreateOrganizationInput, type NotificationPreferencesInput, slugify,
  type UpdateOrganizationInput,
} from "@/shared/schemas/organization";
import type {
  CreatedInvitationDto, InvitationDto, InvitationPreviewDto, MemberDto, MembershipDto, NotificationPreferencesDto, OrganizationDto,
} from "@/shared/types";

import { diffFields, recordAudit } from "../../audit";
import { generateToken, hashToken } from "../../auth/tokens";
import { type DbClient, isUniqueViolation, prisma } from "../../db";
import { appUrl } from "../../env";
import { conflict, fieldError, forbidden, notFound } from "../../errors";
import { type Actor, authorize, type OrgContext, type RequestMeta } from "../../tenancy";
import { iso, organizationSelect, toOrganizationDto } from "../mappers";

const DAY_MS = 86_400_000;

/** Finds a free slug, appending -2, -3, … when the preferred one is taken. */
async function allocateSlug(db: DbClient, preferred: string): Promise<string> {
  const base = slugify(preferred) || "workspace";
  for (let suffix = 1; suffix < 50; suffix++) {
    const candidate = (suffix === 1 ? base : `${base.slice(0, 36)}-${suffix}`).padEnd(3, "0");
    if (RESERVED_SLUGS.has(candidate)) continue;
    const taken = await db.organization.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  return `${base.slice(0, 30)}-${generateToken(4).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
}

/** Creates an organization with `userId` as its owner. Used by sign-up and by "New organization". */
export async function createOrganizationFor(
  db: DbClient,
  actor: Actor,
  input: CreateOrganizationInput,
  meta: RequestMeta = {},
): Promise<OrganizationDto> {
  if (input.slug) {
    const taken = await db.organization.findUnique({ where: { slug: input.slug }, select: { id: true } });
    if (taken) throw conflict("That address is already taken.", { slug: ["That address is already taken."] });
  }
  const slug = input.slug ?? (await allocateSlug(db, input.name));
  const org = await db.organization.create({
    data: { name: input.name, slug, members: { create: { userId: actor.userId, role: OrgRole.OWNER } } },
    select: { ...organizationSelect, members: { select: { id: true } } },
  });
  await db.auditLog.create({
    data: {
      organizationId: org.id, actorId: actor.userId, actorLabel: actor.email, action: "organization.created",
      targetType: "organization", targetId: org.id, targetLabel: org.name,
      ipAddress: meta.ipAddress ?? null, userAgent: meta.userAgent?.slice(0, 400) ?? null,
    },
  });
  return toOrganizationDto(org);
}

export async function createOrganization(actor: Actor, input: CreateOrganizationInput, meta: RequestMeta): Promise<OrganizationDto> {
  try {
    return await prisma.$transaction((tx) => createOrganizationFor(tx, actor, input, meta));
  } catch (error) {
    if (isUniqueViolation(error, "slug")) throw conflict("That address is already taken.", { slug: ["That address is already taken."] });
    throw error;
  }
}

export async function listMemberships(userId: string): Promise<MembershipDto[]> {
  const rows = await prisma.organizationMember.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { role: true, organization: { select: organizationSelect } },
  });
  return rows.map((row) => ({ role: row.role, organization: toOrganizationDto(row.organization) }));
}

export async function getOrganization(ctx: OrgContext): Promise<OrganizationDto> {
  authorize(ctx, "org:read");
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.organization.id }, select: organizationSelect });
  return toOrganizationDto(org);
}

export async function updateOrganization(ctx: OrgContext, input: UpdateOrganizationInput): Promise<OrganizationDto> {
  authorize(ctx, "org:update");
  return prisma.$transaction(async (tx) => {
    const before = await tx.organization.findUniqueOrThrow({ where: { id: ctx.organization.id }, select: organizationSelect });
    const org = await tx.organization.update({ where: { id: ctx.organization.id }, data: input, select: organizationSelect });
    const changes = diffFields(before, input, ["name", "autoResolveIncidents"]);
    if (Object.keys(changes).length > 0) {
      await recordAudit(tx, ctx, { action: "organization.updated", target: { type: "organization", id: org.id, label: org.name }, metadata: { changes } });
    }
    return toOrganizationDto(org);
  });
}

export async function deleteOrganization(ctx: OrgContext, confirmSlug: string): Promise<void> {
  authorize(ctx, "org:delete");
  if (confirmSlug !== ctx.organization.slug) throw fieldError("confirm", "Type the organization address exactly to confirm.");
  // Cascades remove every tenant-owned row, the audit log included: the tenant is gone.
  await prisma.organization.delete({ where: { id: ctx.organization.id } });
}

// ── Members ─────────────────────────────────────────────────────────────────

export async function listMembers(ctx: OrgContext): Promise<MemberDto[]> {
  authorize(ctx, "member:read");
  const rows = await prisma.organizationMember.findMany({
    where: { organizationId: ctx.organization.id },
    orderBy: [{ createdAt: "asc" }],
    select: { id: true, role: true, createdAt: true, user: { select: { id: true, name: true, email: true } } },
  });
  return rows.map((row) => ({
    id: row.id, userId: row.user.id, name: row.user.name, email: row.user.email, role: row.role,
    joinedAt: iso(row.createdAt), isYou: row.user.id === ctx.actor.userId,
  }));
}

async function countOwners(db: DbClient, organizationId: string): Promise<number> {
  return db.organizationMember.count({ where: { organizationId, role: OrgRole.OWNER } });
}

export async function updateMemberRole(ctx: OrgContext, memberId: string, role: OrgRole): Promise<MemberDto> {
  authorize(ctx, "member:manage");
  return prisma.$transaction(async (tx) => {
    // Lock the organization row so two concurrent demotions cannot both pass the last-owner check.
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${ctx.organization.id}::uuid FOR UPDATE`;
    const member = await tx.organizationMember.findFirst({
      where: { id: memberId, organizationId: ctx.organization.id },
      select: { id: true, role: true, createdAt: true, user: { select: { id: true, name: true, email: true } } },
    });
    if (!member) throw notFound("Member");
    if (!canManageRole(ctx.role, member.role) || !canManageRole(ctx.role, role)) {
      throw forbidden("Your role cannot make that change.");
    }
    if (member.role === OrgRole.OWNER && role !== OrgRole.OWNER && (await countOwners(tx, ctx.organization.id)) <= 1) {
      throw conflict("An organization needs at least one owner. Promote someone else first.");
    }
    if (member.role !== role) {
      await tx.organizationMember.update({ where: { id: member.id }, data: { role } });
      await recordAudit(tx, ctx, {
        action: "member.role_changed",
        target: { type: "member", id: member.user.id, label: member.user.email },
        metadata: { from: member.role, to: role },
      });
    }
    return {
      id: member.id, userId: member.user.id, name: member.user.name, email: member.user.email, role,
      joinedAt: iso(member.createdAt), isYou: member.user.id === ctx.actor.userId,
    };
  });
}

/** Removes a member, or lets a member leave. Never leaves an organization without an owner. */
export async function removeMember(ctx: OrgContext, memberId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${ctx.organization.id}::uuid FOR UPDATE`;
    const member = await tx.organizationMember.findFirst({
      where: { id: memberId, organizationId: ctx.organization.id },
      select: { id: true, role: true, user: { select: { id: true, email: true } } },
    });
    if (!member) throw notFound("Member");
    const leaving = member.user.id === ctx.actor.userId;
    if (!leaving) {
      authorize(ctx, "member:manage");
      if (!canManageRole(ctx.role, member.role)) throw forbidden("Your role cannot remove that member.");
    }
    if (member.role === OrgRole.OWNER && (await countOwners(tx, ctx.organization.id)) <= 1) {
      throw conflict("An organization needs at least one owner. Promote someone else first.");
    }
    await tx.organizationMember.delete({ where: { id: member.id } });
    await tx.incident.updateMany({ where: { organizationId: ctx.organization.id, assigneeId: member.user.id }, data: { assigneeId: null } });
    await recordAudit(tx, ctx, {
      action: leaving ? "member.left" : "member.removed",
      target: { type: "member", id: member.user.id, label: member.user.email },
      metadata: { role: member.role },
    });
  });
}

// ── Notification preferences (personal, per organization) ───────────────────

const preferenceSelect = {
  notifyIncidentCreated: true, notifyIncidentResolved: true, notifyMonitorDown: true, notifyMonitorRecovered: true,
} as const;

export async function getPreferences(ctx: OrgContext): Promise<NotificationPreferencesDto> {
  return prisma.organizationMember.findUniqueOrThrow({ where: { id: ctx.membershipId }, select: preferenceSelect });
}

export async function updatePreferences(ctx: OrgContext, input: NotificationPreferencesInput): Promise<NotificationPreferencesDto> {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.organizationMember.update({ where: { id: ctx.membershipId }, data: input, select: preferenceSelect });
    await recordAudit(tx, ctx, { action: "notification_preferences.updated", target: { type: "member", id: ctx.actor.userId, label: ctx.actor.email }, metadata: input });
    return updated;
  });
}

// ── Invitations ─────────────────────────────────────────────────────────────

const invitationSelect = {
  id: true, email: true, role: true, createdAt: true, expiresAt: true, invitedBy: { select: { name: true } },
} as const;

function toInvitationDto(row: { id: string; email: string; role: OrgRole; createdAt: Date; expiresAt: Date; invitedBy: { name: string } | null }): InvitationDto {
  return {
    id: row.id, email: row.email, role: row.role, invitedBy: row.invitedBy?.name ?? null,
    createdAt: iso(row.createdAt), expiresAt: iso(row.expiresAt), expired: row.expiresAt.getTime() <= Date.now(),
  };
}

export async function listInvitations(ctx: OrgContext): Promise<InvitationDto[]> {
  authorize(ctx, "member:manage");
  const rows = await prisma.invitation.findMany({
    where: { organizationId: ctx.organization.id, acceptedAt: null },
    orderBy: { createdAt: "desc" },
    select: invitationSelect,
  });
  return rows.map(toInvitationDto);
}

export async function createInvitation(ctx: OrgContext, input: CreateInvitationInput): Promise<CreatedInvitationDto> {
  authorize(ctx, "member:manage");
  if (!canManageRole(ctx.role, input.role)) throw forbidden("Your role cannot grant that role.");

  const existingMember = await prisma.organizationMember.findFirst({
    where: { organizationId: ctx.organization.id, user: { email: input.email } },
    select: { id: true },
  });
  if (existingMember) throw conflict("That person is already a member.", { email: ["That person is already a member."] });

  const token = generateToken();
  const data = {
    role: input.role, tokenHash: hashToken(token), invitedById: ctx.actor.userId,
    expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * DAY_MS), acceptedAt: null, createdAt: new Date(),
  };
  const inviteUrl = appUrl(routes.invite(token));

  const invitation = await prisma.$transaction(async (tx) => {
    // Re-inviting the same address rotates the token, which invalidates the old link.
    const row = await tx.invitation.upsert({
      where: { organizationId_email: { organizationId: ctx.organization.id, email: input.email } },
      create: { organizationId: ctx.organization.id, email: input.email, ...data },
      update: data,
      select: invitationSelect,
    });
    await recordAudit(tx, ctx, { action: "member.invited", target: { type: "invitation", id: row.id, label: input.email }, metadata: { role: input.role } });
    return row;
  });

  return { ...toInvitationDto(invitation), inviteUrl, emailQueued: false };
}

export async function revokeInvitation(ctx: OrgContext, invitationId: string): Promise<void> {
  authorize(ctx, "member:manage");
  await prisma.$transaction(async (tx) => {
    const invitation = await tx.invitation.findFirst({ where: { id: invitationId, organizationId: ctx.organization.id }, select: { id: true, email: true } });
    if (!invitation) throw notFound("Invitation");
    await tx.invitation.delete({ where: { id: invitation.id } });
    await recordAudit(tx, ctx, { action: "member.invitation_revoked", target: { type: "invitation", id: invitation.id, label: invitation.email } });
  });
}

async function findLiveInvitation(db: DbClient, token: string) {
  const invitation = await db.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true, email: true, role: true, expiresAt: true, acceptedAt: true, organizationId: true,
      organization: { select: { name: true, slug: true } }, invitedBy: { select: { name: true } },
    },
  });
  if (!invitation || invitation.acceptedAt || invitation.expiresAt.getTime() <= Date.now()) return null;
  return invitation;
}

/** Public: lets the invite page show who is inviting to what. Reveals nothing for bad tokens. */
export async function previewInvitation(token: string): Promise<InvitationPreviewDto> {
  const invitation = await findLiveInvitation(prisma, token);
  if (!invitation) throw notFound("Invitation");
  const account = await prisma.user.findUnique({ where: { email: invitation.email }, select: { id: true } });
  return {
    organizationName: invitation.organization.name, email: invitation.email, role: invitation.role,
    inviterName: invitation.invitedBy?.name ?? null, expiresAt: iso(invitation.expiresAt), accountExists: Boolean(account),
  };
}

/**
 * Accepts an invitation for an authenticated user. The invitation is bound to
 * an email address: a leaked link is useless to anyone signed in as someone else.
 */
export async function acceptInvitation(db: DbClient, actor: Actor, token: string, meta: RequestMeta = {}): Promise<{ orgSlug: string }> {
  const invitation = await findLiveInvitation(db, token);
  if (!invitation) throw notFound("Invitation");
  if (invitation.email !== actor.email.toLowerCase()) {
    throw forbidden(`This invitation was sent to ${invitation.email}. Sign in with that address to accept it.`);
  }
  const existing = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: invitation.organizationId, userId: actor.userId } },
    select: { id: true },
  });
  if (!existing) {
    await db.organizationMember.create({ data: { organizationId: invitation.organizationId, userId: actor.userId, role: invitation.role } });
    await db.auditLog.create({
      data: {
        organizationId: invitation.organizationId, actorId: actor.userId, actorLabel: actor.email, action: "member.joined",
        targetType: "member", targetId: actor.userId, targetLabel: actor.email, metadata: { role: invitation.role },
        ipAddress: meta.ipAddress ?? null, userAgent: meta.userAgent?.slice(0, 400) ?? null,
      },
    });
  }
  await db.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });
  return { orgSlug: invitation.organization.slug };
}
