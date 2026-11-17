import { z } from "zod";

/**
 * Environment validation.
 *
 * Parsed lazily and memoized: importing this module never throws, so `next
 * build` works without runtime secrets. The web server validates at boot from
 * `instrumentation.ts` and the worker at startup, so a misconfigured
 * deployment fails immediately with a readable list of what is wrong instead
 * of at the first request that happens to need the missing value.
 */

const int = (min: number, max: number, fallback: number) => z.coerce.number().int().min(min).max(max).default(fallback);
const flag = (fallback: boolean) => z.stringbool().default(fallback);

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    /** Public origin of the web app. Used for links in emails and for the cookie `Secure` flag. */
    APP_URL: z
      .url({ protocol: /^https?$/ })
      .default("http://localhost:3000")
      .transform((value) => value.replace(/\/+$/, "")),
    DATABASE_URL: z
      .string({ error: "DATABASE_URL is required." })
      .regex(/^postgres(ql)?:\/\//, "DATABASE_URL must be a postgresql:// connection string."),
    DATABASE_POOL_MAX: int(1, 200, 10),
    REDIS_URL: z
      .string()
      .regex(/^rediss?:\/\//, "REDIS_URL must be a redis:// or rediss:// URL.")
      .default("redis://localhost:6379"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

    // ── Authentication ──────────────────────────────────────────────────────
    SESSION_TTL_DAYS: int(1, 365, 30),
    /** Set to false to run a private instance where accounts are created by invitation only. */
    ALLOW_SIGNUP: flag(true),
    /**
     * Number of reverse proxies in front of the app that append to
     * X-Forwarded-For. The client IP is read that many entries from the right.
     */
    TRUSTED_PROXY_HOPS: int(0, 10, 1),

    // ── Monitoring ──────────────────────────────────────────────────────────
    MONITOR_MIN_INTERVAL_SECONDS: int(10, 86_400, 30),
    MONITOR_MAX_PER_ORG: int(1, 10_000, 100),
    /**
     * Comma-separated `host` or `host:port` entries exempt from the private-
     * network block. Empty by default. Every entry is a deliberate hole in the
     * SSRF policy: see docs/security.md before setting it.
     */
    MONITOR_ALLOWED_PRIVATE_HOSTS: z.string().default(""),
    CHECK_RETENTION_DAYS: int(1, 3650, 30),
    WORKER_CONCURRENCY: int(1, 500, 20),
    SCHEDULER_TICK_MS: int(250, 60_000, 2000),
    SCHEDULER_BATCH_SIZE: int(1, 5000, 200),
    /** Fairness cap: the most checks one organization can have enqueued per tick. */
    SCHEDULER_MAX_PER_ORG: int(1, 5000, 50),
    /** 0 disables the worker's HTTP health endpoint. */
    WORKER_HEALTH_PORT: int(0, 65_535, 0),

    // ── Notifications ───────────────────────────────────────────────────────
    /** e.g. smtp://user:pass@smtp.example.com:587. Unset = email is recorded but not sent. */
    SMTP_URL: z
      .string()
      .regex(/^smtps?:\/\//, "SMTP_URL must start with smtp:// or smtps://.")
      .optional(),
    EMAIL_FROM: z.string().min(3).default("PulseOps <alerts@pulseops.localhost>"),
    /** Per-destination ceiling. Deliveries beyond it are recorded as SUPPRESSED. */
    NOTIFICATION_MAX_PER_HOUR: int(1, 10_000, 60),

    // ── AI assistant (optional, off by default) ─────────────────────────────
    AI_PROVIDER: z.enum(["none", "anthropic"]).default("none"),
    ANTHROPIC_API_KEY: z.string().min(10).optional(),
    AI_MODEL: z.string().min(3).default("claude-opus-5-5"),
    AI_MAX_OUTPUT_TOKENS: int(1024, 32_000, 6000),
    AI_RATE_LIMIT_PER_HOUR: int(1, 1000, 10),

    // ── Demo ────────────────────────────────────────────────────────────────
    /** Base URL of the bundled target simulator the seeded monitors point at. */
    DEMO_TARGETS_URL: z.url({ protocol: /^https?$/ }).default("http://localhost:4010"),
  })
  .superRefine((env, ctx) => {
    if (env.AI_PROVIDER === "anthropic" && !env.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["ANTHROPIC_API_KEY"],
        message: "ANTHROPIC_API_KEY is required when AI_PROVIDER=anthropic.",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Empty strings in .env files mean "unset", not "the empty string". */
function withoutBlanks(source: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value.trim() !== "") result[key] = value;
  }
  return result;
}

export class EnvValidationError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid environment configuration:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
    this.name = "EnvValidationError";
  }
}

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(withoutBlanks(source));
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    );
  }
  return result.data;
}

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Tests mutate `process.env`; this drops the memoized copy. */
export function resetEnvCache(): void {
  cached = undefined;
}

export interface AllowedPrivateHost {
  host: string;
  port: number | null;
}

/** Parses MONITOR_ALLOWED_PRIVATE_HOSTS into normalized host/port pairs. */
export function parseAllowedPrivateHosts(raw: string): AllowedPrivateHost[] {
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .map((entry) => {
      // Bracketed IPv6 with optional port: [::1]:8080
      const ipv6 = /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(entry);
      if (ipv6) return { host: ipv6[1] ?? "", port: ipv6[2] ? Number(ipv6[2]) : null };
      const lastColon = entry.lastIndexOf(":");
      if (lastColon > 0 && entry.indexOf(":") === lastColon) {
        return { host: entry.slice(0, lastColon), port: Number(entry.slice(lastColon + 1)) };
      }
      return { host: entry, port: null };
    })
    .filter((entry) => entry.host.length > 0 && (entry.port === null || (entry.port > 0 && entry.port <= 65_535)));
}

export const isProduction = () => getEnv().NODE_ENV === "production";
export const appUrl = (path = "") => `${getEnv().APP_URL}${path}`;
export const isSecureOrigin = () => getEnv().APP_URL.startsWith("https://");
export const isEmailConfigured = () => Boolean(getEnv().SMTP_URL);
export const isAiEnabled = () => getEnv().AI_PROVIDER === "anthropic" && Boolean(getEnv().ANTHROPIC_API_KEY);
