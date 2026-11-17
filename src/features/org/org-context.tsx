"use client";

import { createContext, use, useMemo } from "react";

import type { OrgRole } from "@/shared/enums";
import { can, type Permission } from "@/shared/permissions";
import { apiRoutes, routes } from "@/shared/routes";
import type { MembershipDto, OrganizationDto, UserRef } from "@/shared/types";

export interface OrgContextValue {
  user: UserRef;
  organization: OrganizationDto;
  role: OrgRole;
  memberships: MembershipDto[];
  /** Whether the AI assistant is configured on this deployment. */
  aiEnabled: boolean;
}

interface Derived extends OrgContextValue {
  paths: ReturnType<typeof routes.org>;
  /** Base URL of this organization's API, e.g. /api/v1/orgs/acme. */
  api: string;
  can: (permission: Permission) => boolean;
}

const OrgContext = createContext<Derived | null>(null);

export function OrgProvider({ value, children }: { value: OrgContextValue; children: React.ReactNode }) {
  const derived = useMemo<Derived>(
    () => ({
      ...value,
      paths: routes.org(value.organization.slug),
      api: apiRoutes.org(value.organization.slug),
      // Mirrors the server's policy table to decide what to render. The server still enforces it.
      can: (permission) => can(value.role, permission),
    }),
    [value],
  );
  return <OrgContext value={derived}>{children}</OrgContext>;
}

export function useOrg(): Derived {
  const context = use(OrgContext);
  if (!context) throw new Error("useOrg must be used inside the organization layout.");
  return context;
}

/** Query-key factory: every key is namespaced by organization so caches never cross tenants. */
export const orgKey = (slug: string, ...parts: unknown[]) => ["org", slug, ...parts] as const;
