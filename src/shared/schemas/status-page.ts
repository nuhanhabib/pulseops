import { z } from "zod";

import { StatusPageTheme } from "../enums";
import { optionalText, uuidSchema } from "./common";
import { slugSchema } from "./organization";

const httpUrl = z
  .string()
  .trim()
  .max(500)
  .refine(
    (value) => {
      try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "http:";
      } catch {
        return false;
      }
    },
    { error: "Enter a full URL, including https://." },
  );

export const statusPageMonitorSchema = z.object({
  monitorId: uuidSchema,
  /** What the public sees. The private monitor name and URL are never published. */
  displayName: z
    .string()
    .trim()
    .min(1, "Give this component a public name.")
    .max(60, "Keep the name under 60 characters."),
  description: optionalText(160),
});

export const statusPageFieldsSchema = z.object({
  name: z.string().trim().min(2, "Give the page a name.").max(80, "Keep the name under 80 characters."),
  slug: slugSchema,
  description: optionalText(280),
  published: z.boolean().default(false),
  accentColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex colour, e.g. #6366f1.")
    .default("#6366f1"),
  theme: z.enum(StatusPageTheme).default(StatusPageTheme.AUTO),
  uptimeDays: z.union([z.literal(30), z.literal(60), z.literal(90)]).default(90),
  showIncidentHistory: z.boolean().default(true),
  supportUrl: z
    .union([httpUrl, z.literal("")])
    .nullish()
    .transform((value) => (value ? value : null)),
  /** Order in the array is the display order. */
  monitors: z.array(statusPageMonitorSchema).max(50, "A status page can show at most 50 components.").default([]),
});

const uniqueMonitors = (input: { monitors?: { monitorId: string }[] }) =>
  !input.monitors || new Set(input.monitors.map((item) => item.monitorId)).size === input.monitors.length;

export const createStatusPageSchema = statusPageFieldsSchema.refine(uniqueMonitors, {
  error: "Each monitor can appear only once.",
  path: ["monitors"],
});

export const updateStatusPageSchema = statusPageFieldsSchema
  .partial()
  .refine((input) => Object.keys(input).length > 0, { error: "Nothing to update." })
  .refine(uniqueMonitors, { error: "Each monitor can appear only once.", path: ["monitors"] });

export type CreateStatusPageInput = z.infer<typeof createStatusPageSchema>;
export type StatusPageFormValues = z.input<typeof createStatusPageSchema>;
export type UpdateStatusPageInput = z.infer<typeof updateStatusPageSchema>;
