import { z } from "zod";

import { MONITOR_DEFAULTS, MONITOR_LIMITS } from "../constants";
import { CheckStatus, HttpMethod, IncidentSeverity, MonitorKind, MonitorStatus } from "../enums";
import { parseStatusExpression } from "../status-codes";
import { csvEnum, cursorQuerySchema, optionalText, pageQuerySchema, searchTermSchema, sortDirectionSchema } from "./common";

const limits = MONITOR_LIMITS;

/**
 * Shape-level URL rules that are safe to run in the browser. The network
 * policy (private ranges, metadata endpoints, DNS resolution) is enforced on
 * the server, at save time and again on every connection the worker opens.
 */
export const monitorUrlSchema = z
  .string()
  .trim()
  .min(1, "Enter the URL to monitor.")
  .max(2048, "That URL is too long.")
  .superRefine((value, ctx) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter a full URL, including https://." });
      return;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      ctx.addIssue({ code: "custom", message: "Only http:// and https:// URLs can be monitored." });
    }
    if (url.username || url.password) {
      ctx.addIssue({ code: "custom", message: "Remove the username and password from the URL." });
    }
    if (!url.hostname) {
      ctx.addIssue({ code: "custom", message: "The URL needs a hostname." });
    }
  });

const expectedStatusSchema = z
  .string()
  .trim()
  .max(120)
  .superRefine((value, ctx) => {
    const result = parseStatusExpression(value);
    if (!result.ok) ctx.addIssue({ code: "custom", message: result.error });
  });

const integer = (label: string, range: { min: number; max: number }, unit = "") =>
  z
    .number({ error: `${label} must be a number.` })
    .int(`${label} must be a whole number.`)
    .min(range.min, `${label} must be at least ${range.min}${unit}.`)
    .max(range.max, `${label} must be at most ${range.max}${unit}.`);

/** Field rules only. Cross-field rules live in `monitorCrossFieldRules`. */
export const monitorFieldsSchema = z.object({
  name: z.string().trim().min(1, "Give the monitor a name.").max(80, "Keep the name under 80 characters."),
  url: monitorUrlSchema,
  kind: z.enum(MonitorKind).default(MONITOR_DEFAULTS.kind),
  method: z.enum(HttpMethod).default(MONITOR_DEFAULTS.method),
  category: optionalText(40),
  intervalSeconds: integer("Interval", limits.intervalSeconds, " seconds").default(MONITOR_DEFAULTS.intervalSeconds),
  timeoutMs: integer("Timeout", limits.timeoutMs, " ms").default(MONITOR_DEFAULTS.timeoutMs),
  expectedStatusCodes: expectedStatusSchema.default(MONITOR_DEFAULTS.expectedStatusCodes),
  followRedirects: z.boolean().default(MONITOR_DEFAULTS.followRedirects),
  retries: integer("Retries", limits.retries).default(MONITOR_DEFAULTS.retries),
  degradedThresholdMs: integer("Degraded threshold", limits.degradedThresholdMs, " ms")
    .nullable()
    .default(MONITOR_DEFAULTS.degradedThresholdMs),
  failureThreshold: integer("Failure threshold", limits.failureThreshold).default(MONITOR_DEFAULTS.failureThreshold),
  recoveryThreshold: integer("Recovery threshold", limits.recoveryThreshold).default(MONITOR_DEFAULTS.recoveryThreshold),
  autoIncident: z.boolean().default(MONITOR_DEFAULTS.autoIncident),
  incidentSeverity: z.enum(IncidentSeverity).default(MONITOR_DEFAULTS.incidentSeverity),
  enabled: z.boolean().default(MONITOR_DEFAULTS.enabled),
});

type MonitorTimingFields = Pick<z.infer<typeof monitorFieldsSchema>, "intervalSeconds" | "timeoutMs" | "retries" | "degradedThresholdMs">;

/**
 * A check may take `timeout × (retries + 1)` in the worst case. If that
 * exceeds the interval, checks would queue behind themselves, so reject it.
 */
export function monitorCrossFieldIssues(input: MonitorTimingFields): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  const worstCaseMs = input.timeoutMs * (input.retries + 1);
  if (worstCaseMs > input.intervalSeconds * 1000) {
    issues.push({
      path: "timeoutMs",
      message: `Timeout × attempts (${Math.round(worstCaseMs / 1000)}s) must fit inside the ${input.intervalSeconds}s interval. Lower the timeout or retries, or raise the interval.`,
    });
  }
  if (input.degradedThresholdMs !== null && input.degradedThresholdMs >= input.timeoutMs) {
    issues.push({
      path: "degradedThresholdMs",
      message: "The degraded threshold must be lower than the timeout, or it can never trigger.",
    });
  }
  return issues;
}

export const createMonitorSchema = monitorFieldsSchema.superRefine((input, ctx) => {
  for (const issue of monitorCrossFieldIssues(input)) {
    ctx.addIssue({ code: "custom", message: issue.message, path: [issue.path] });
  }
});

/**
 * Updates are partial; the service merges them onto the stored monitor and
 * re-runs the cross-field rules against the result.
 */
export const updateMonitorSchema = z
  .object({
    name: monitorFieldsSchema.shape.name,
    url: monitorUrlSchema,
    kind: z.enum(MonitorKind),
    method: z.enum(HttpMethod),
    category: optionalText(40),
    intervalSeconds: integer("Interval", limits.intervalSeconds, " seconds"),
    timeoutMs: integer("Timeout", limits.timeoutMs, " ms"),
    expectedStatusCodes: expectedStatusSchema,
    followRedirects: z.boolean(),
    retries: integer("Retries", limits.retries),
    degradedThresholdMs: integer("Degraded threshold", limits.degradedThresholdMs, " ms").nullable(),
    failureThreshold: integer("Failure threshold", limits.failureThreshold),
    recoveryThreshold: integer("Recovery threshold", limits.recoveryThreshold),
    autoIncident: z.boolean(),
    incidentSeverity: z.enum(IncidentSeverity),
    enabled: z.boolean(),
  })
  .partial()
  .refine((input) => Object.keys(input).length > 0, { error: "Nothing to update." });

/** A one-off check from the "Test" button. Never persisted. */
export const testMonitorSchema = z.object({
  url: monitorUrlSchema,
  method: z.enum(HttpMethod).default(MONITOR_DEFAULTS.method),
  timeoutMs: integer("Timeout", limits.timeoutMs, " ms").default(MONITOR_DEFAULTS.timeoutMs),
  expectedStatusCodes: expectedStatusSchema.default(MONITOR_DEFAULTS.expectedStatusCodes),
  followRedirects: z.boolean().default(MONITOR_DEFAULTS.followRedirects),
});

export const MONITOR_SORT_FIELDS = ["name", "status", "createdAt", "lastCheckedAt", "lastResponseTimeMs"] as const;

export const listMonitorsQuerySchema = pageQuerySchema.extend({
  q: searchTermSchema,
  status: csvEnum(Object.values(MonitorStatus) as [MonitorStatus, ...MonitorStatus[]]),
  kind: z.enum(MonitorKind).optional(),
  category: z.string().trim().max(40).optional(),
  sort: z.enum(MONITOR_SORT_FIELDS).default("name"),
  direction: sortDirectionSchema.default("asc"),
});

export const listChecksQuerySchema = cursorQuerySchema.extend({
  status: csvEnum(Object.values(CheckStatus) as [CheckStatus, ...CheckStatus[]]),
});

export type CreateMonitorInput = z.infer<typeof createMonitorSchema>;
export type CreateMonitorFormValues = z.input<typeof createMonitorSchema>;
export type UpdateMonitorInput = z.infer<typeof updateMonitorSchema>;
export type TestMonitorInput = z.infer<typeof testMonitorSchema>;
export type ListMonitorsQuery = z.infer<typeof listMonitorsQuerySchema>;
export type ListChecksQuery = z.infer<typeof listChecksQuerySchema>;
