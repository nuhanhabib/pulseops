import { z } from "zod";

import { TIME_RANGE_KEYS } from "../constants";

export const uuidSchema = z.uuid("Invalid identifier.");

/** Trims, and turns an empty string into null so "cleared" fields persist as NULL. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .nullish()
    .transform((value) => (value ? value : null));

export const timeRangeSchema = z.enum(TIME_RANGE_KEYS).default("24h");

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const cursorQuerySchema = z.object({
  cursor: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const sortDirectionSchema = z.enum(["asc", "desc"]).default("desc");

/**
 * Accepts either repeated query parameters (?status=UP&status=DOWN) or a
 * comma-separated list (?status=UP,DOWN) and validates each entry.
 */
export function csvEnum<const T extends readonly [string, ...string[]]>(values: T) {
  return z
    .preprocess((input) => {
      if (input === undefined || input === null || input === "") return undefined;
      const list = Array.isArray(input) ? input : String(input).split(",");
      return list.map((item) => String(item).trim()).filter(Boolean);
    }, z.array(z.enum(values)).max(values.length))
    .optional();
}

export const searchTermSchema = z
  .string()
  .trim()
  .max(120)
  .optional()
  .transform((value) => (value ? value : undefined));
