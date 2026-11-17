import { z } from "zod";

import { RESERVED_SLUGS } from "../constants";
import { OrgRole } from "../enums";
import { emailSchema, organizationNameSchema } from "./auth";

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Use at least 3 characters.")
  .max(40, "Keep it under 40 characters.")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and single hyphens.")
  .refine((slug) => !RESERVED_SLUGS.has(slug), { error: "That address is reserved. Choose another." });

export const createOrganizationSchema = z.object({
  name: organizationNameSchema,
  slug: slugSchema.optional(),
});

export const updateOrganizationSchema = z
  .object({
    name: organizationNameSchema,
    autoResolveIncidents: z.boolean(),
  })
  .partial()
  .refine((input) => Object.keys(input).length > 0, { error: "Nothing to update." });

/** Ownership is granted by promoting an existing member, never by invitation. */
export const invitableRoleSchema = z.enum([OrgRole.ADMIN, OrgRole.MEMBER, OrgRole.VIEWER]);

export const createInvitationSchema = z.object({
  email: emailSchema,
  role: invitableRoleSchema.default(OrgRole.MEMBER),
});

export const updateMemberRoleSchema = z.object({
  role: z.enum(OrgRole),
});

export const notificationPreferencesSchema = z.object({
  notifyIncidentCreated: z.boolean(),
  notifyIncidentResolved: z.boolean(),
  notifyMonitorDown: z.boolean(),
  notifyMonitorRecovered: z.boolean(),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;
export type NotificationPreferencesInput = z.infer<typeof notificationPreferencesSchema>;

/** "Northwind Traders, Inc." → "northwind-traders-inc" */
export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}
