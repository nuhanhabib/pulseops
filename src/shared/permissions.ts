import { OrgRole } from "./enums";

/**
 * Role-based access control.
 *
 * Authorization is expressed as permissions, never as role comparisons at the
 * call site, so the policy lives in exactly one table. The server enforces it
 * in the service layer; the browser reads the same table only to decide what
 * to render.
 */
export const PERMISSIONS = [
  "org:read",
  "org:update",
  "org:delete",
  "member:read",
  "member:manage",
  "monitor:read",
  "monitor:write",
  "monitor:delete",
  "incident:read",
  "incident:write",
  "incident:delete",
  "statuspage:read",
  "statuspage:write",
  "notification:read",
  "notification:manage",
  "ai:use",
  "audit:read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const VIEWER: Permission[] = [
  "org:read",
  "member:read",
  "monitor:read",
  "incident:read",
  "statuspage:read",
  "notification:read",
];

const MEMBER: Permission[] = [...VIEWER, "monitor:write", "incident:write", "statuspage:write", "ai:use"];

const ADMIN: Permission[] = [
  ...MEMBER,
  "org:update",
  "member:manage",
  "monitor:delete",
  "incident:delete",
  "notification:manage",
  "audit:read",
];

const OWNER: Permission[] = [...ADMIN, "org:delete"];

const ROLE_PERMISSIONS: Record<OrgRole, ReadonlySet<Permission>> = {
  [OrgRole.VIEWER]: new Set(VIEWER),
  [OrgRole.MEMBER]: new Set(MEMBER),
  [OrgRole.ADMIN]: new Set(ADMIN),
  [OrgRole.OWNER]: new Set(OWNER),
};

const ROLE_RANK: Record<OrgRole, number> = {
  [OrgRole.VIEWER]: 0,
  [OrgRole.MEMBER]: 1,
  [OrgRole.ADMIN]: 2,
  [OrgRole.OWNER]: 3,
};

export function can(role: OrgRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export function permissionsFor(role: OrgRole): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export function roleRank(role: OrgRole): number {
  return ROLE_RANK[role];
}

/**
 * Whether `actor` may assign, change, or remove a member holding `target`.
 * Owners manage everyone; admins manage only roles strictly below their own,
 * so an admin can never promote to, demote, or remove an owner or a peer.
 */
export function canManageRole(actor: OrgRole, target: OrgRole): boolean {
  if (!can(actor, "member:manage")) return false;
  if (actor === OrgRole.OWNER) return true;
  return ROLE_RANK[target] < ROLE_RANK[actor];
}

/** Roles `actor` is allowed to grant to somebody else. */
export function assignableRoles(actor: OrgRole): OrgRole[] {
  return (Object.keys(ROLE_RANK) as OrgRole[]).filter((role) => canManageRole(actor, role));
}

export const ROLE_LABELS: Record<OrgRole, string> = {
  [OrgRole.OWNER]: "Owner",
  [OrgRole.ADMIN]: "Admin",
  [OrgRole.MEMBER]: "Member",
  [OrgRole.VIEWER]: "Viewer",
};

export const ROLE_DESCRIPTIONS: Record<OrgRole, string> = {
  [OrgRole.OWNER]: "Full control, including deleting the organization and managing other owners.",
  [OrgRole.ADMIN]: "Manages members, settings, notification channels, and can read the audit log.",
  [OrgRole.MEMBER]: "Creates and edits monitors, runs incidents, and edits status pages.",
  [OrgRole.VIEWER]: "Read-only access to monitors, incidents, and status pages.",
};
