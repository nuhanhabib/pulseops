import { z } from "zod";

import { IncidentSeverity, IncidentSource, IncidentStatus } from "../enums";
import { csvEnum, optionalText, pageQuerySchema, searchTermSchema, sortDirectionSchema, uuidSchema } from "./common";

const titleSchema = z
  .string()
  .trim()
  .min(3, "Describe the incident in a few words.")
  .max(140, "Keep the title under 140 characters.");

const messageSchema = z
  .string()
  .trim()
  .min(1, "Write a message before posting.")
  .max(5000, "Keep it under 5,000 characters.");

const monitorIdsSchema = z.array(uuidSchema).max(50, "Link at most 50 monitors.").default([]);

export const createIncidentSchema = z.object({
  title: titleSchema,
  summary: optionalText(5000),
  severity: z.enum(IncidentSeverity).default(IncidentSeverity.MEDIUM),
  status: z.enum(IncidentStatus).default(IncidentStatus.INVESTIGATING),
  monitorIds: monitorIdsSchema,
  assigneeId: uuidSchema.nullish().transform((value) => value ?? null),
  isPublic: z.boolean().default(false),
});

export const updateIncidentSchema = z
  .object({
    title: titleSchema,
    summary: optionalText(5000),
    severity: z.enum(IncidentSeverity),
    assigneeId: uuidSchema.nullable(),
    isPublic: z.boolean(),
  })
  .partial()
  .refine((input) => Object.keys(input).length > 0, { error: "Nothing to update." });

/**
 * A timeline update. Supplying `status` moves the incident; choosing RESOLVED
 * is how an incident is closed. `isPublic` publishes the message to any status
 * page showing the incident, and is ignored unless the incident is public.
 */
export const createIncidentUpdateSchema = z.object({
  message: messageSchema,
  status: z.enum(IncidentStatus).optional(),
  isPublic: z.boolean().default(false),
});

export const createIncidentNoteSchema = z.object({
  body: messageSchema,
});

export const setIncidentMonitorsSchema = z.object({
  monitorIds: monitorIdsSchema,
});

export const INCIDENT_SORT_FIELDS = ["startedAt", "severity", "status", "number", "updatedAt"] as const;

export const listIncidentsQuerySchema = pageQuerySchema.extend({
  q: searchTermSchema,
  /** `open` and `resolved` are convenience groups over the four statuses. */
  state: z.enum(["all", "open", "resolved"]).default("all"),
  status: csvEnum(Object.values(IncidentStatus) as [IncidentStatus, ...IncidentStatus[]]),
  severity: csvEnum(Object.values(IncidentSeverity) as [IncidentSeverity, ...IncidentSeverity[]]),
  source: z.enum(IncidentSource).optional(),
  monitorId: uuidSchema.optional(),
  assigneeId: z.union([uuidSchema, z.literal("me"), z.literal("unassigned")]).optional(),
  sort: z.enum(INCIDENT_SORT_FIELDS).default("startedAt"),
  direction: sortDirectionSchema,
});

export type CreateIncidentInput = z.infer<typeof createIncidentSchema>;
export type CreateIncidentFormValues = z.input<typeof createIncidentSchema>;
export type UpdateIncidentInput = z.infer<typeof updateIncidentSchema>;
export type CreateIncidentUpdateInput = z.infer<typeof createIncidentUpdateSchema>;
export type CreateIncidentNoteInput = z.infer<typeof createIncidentNoteSchema>;
export type SetIncidentMonitorsInput = z.infer<typeof setIncidentMonitorsSchema>;
export type ListIncidentsQuery = z.infer<typeof listIncidentsQuerySchema>;
