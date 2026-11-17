import pino from "pino";

/**
 * Structured JSON logging to stdout. Collection, shipping, and retention are
 * the platform's job (see docs/deployment.md).
 *
 * The redaction list is defence in depth: call sites should never pass secrets
 * in the first place, but if one slips through in a nested object it is masked
 * here rather than written to disk.
 */
const SENSITIVE_KEYS = [
  "password",
  "currentPassword",
  "newPassword",
  "passwordHash",
  "token",
  "tokenHash",
  "signingSecret",
  "secret",
  "apiKey",
  "authorization",
  "cookie",
  "set-cookie",
];

const redactPaths = SENSITIVE_KEYS.flatMap((key) => {
  const safe = /^[a-zA-Z_$][\w$]*$/.test(key) ? key : `["${key}"]`;
  const dotted = safe.startsWith("[") ? safe : `.${safe}`;
  return [safe, `*${dotted}`, `*.*${dotted}`];
});

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  base: { service: process.env.PULSEOPS_SERVICE ?? "web" },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: { level: (label) => ({ level: label }) },
  redact: { paths: redactPaths, censor: "[redacted]" },
});

export type Logger = typeof logger;

/** Turns any thrown value into a log-safe object. Never includes request bodies. */
export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return {
      name: error.name,
      message: error.message,
      ...(typeof code === "string" || typeof code === "number" ? { code } : {}),
      ...(process.env.NODE_ENV === "production" ? {} : { stack: error.stack }),
    };
  }
  return { message: String(error) };
}
