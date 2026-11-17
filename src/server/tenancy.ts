import type { OrgRole } from "@/shared/enums";
import { can, type Permission } from "@/shared/permissions";

import { prisma } from "./db";
import { forbidden, notFound } from "./errors";

/**
 * Tenant context.
 *
 * Every service function that touches tenant data takes an `OrgContext` as its
 * first argument. It can only be obtained from `resolveOrgContext`, which
 * proves the acting user is a member of the organization. Services then scope
 * every query by `ctx.organization.id`, which is what makes cross-tenant access
 * structurally impossible rather than merely checked.
 */

export interface Actor {
  userId: string;
  email: string;
  name: string;
}

/** Request provenance, recorded in the audit log. */
export interface RequestMeta {
  requestId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface OrgContext {
  organization: {
    id: string;
    slug: string;
    name: string;
    isDemo: boolean;
    autoResolveIncidents: boolean;
  };
  membershipId: string;
  role: OrgRole;
  actor: Actor;
  meta: RequestMeta;
}

/**
 * Looks up the caller's membership in one query. A missing organization and a
 * missing membership are indistinguishable to the caller: both are "not
 * found", so organization slugs cannot be enumerated.
 */
export async function resolveOrgContext(actor: Actor, orgSlug: string, meta: RequestMeta = {}): Promise<OrgContext> {
  const membership = await prisma.organizationMember.findFirst({
    where: { userId: actor.userId, organization: { slug: orgSlug } },
    select: {
      id: true,
      role: true,
      organization: { select: { id: true, slug: true, name: true, isDemo: true, autoResolveIncidents: true } },
    },
  });
  if (!membership) throw notFound("Organization");
  return { organization: membership.organization, membershipId: membership.id, role: membership.role, actor, meta };
}

export function authorize(ctx: OrgContext, permission: Permission): void {
  if (!can(ctx.role, permission)) {
    throw forbidden(`Your role (${ctx.role.toLowerCase()}) cannot do that in this organization.`);
  }
}

export const hasPermission = (ctx: OrgContext, permission: Permission) => can(ctx.role, permission);
