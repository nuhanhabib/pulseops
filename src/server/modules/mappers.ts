import type { OrganizationDto, UserRef } from "@/shared/types";

export const iso = (date: Date) => date.toISOString();
export const isoOrNull = (date: Date | null | undefined) => (date ? date.toISOString() : null);

export const userRefSelect = { id: true, name: true, email: true } as const;

export function toUserRef(user: { id: string; name: string; email: string } | null | undefined): UserRef | null {
  return user ? { id: user.id, name: user.name, email: user.email } : null;
}

export const organizationSelect = {
  id: true, name: true, slug: true, isDemo: true, autoResolveIncidents: true, createdAt: true,
} as const;

export function toOrganizationDto(org: {
  id: string; name: string; slug: string; isDemo: boolean; autoResolveIncidents: boolean; createdAt: Date;
}): OrganizationDto {
  return { id: org.id, name: org.name, slug: org.slug, isDemo: org.isDemo, autoResolveIncidents: org.autoResolveIncidents, createdAt: iso(org.createdAt) };
}

/** "a•••@example.com" — enough to recognize, not enough to harvest. */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}•••@${domain}`;
}

export function maskDestination(recipient: string): string {
  if (recipient.includes("@") && !recipient.includes("://")) return maskEmail(recipient);
  try {
    return new URL(recipient).host;
  } catch {
    return "webhook";
  }
}
