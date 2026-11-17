export const APP_NAME = "PulseOps";
export const APP_TAGLINE = "Know before it breaks. Resolve before it matters.";
export const APP_DESCRIPTION =
  "Uptime monitoring, incident response, and public status pages for teams that run production systems.";

export const SESSION_COOKIE = "pulseops_session";
/** Remembers the last workspace a user opened so sign-in lands them back in it. */
export const LAST_ORG_COOKIE = "pulseops_org";
export const THEME_STORAGE_KEY = "pulseops-theme";

/** Slugs that would collide with routes or read as official. */
export const RESERVED_SLUGS = new Set([
  "admin", "api", "app", "auth", "billing", "contact", "dashboard", "docs", "features", "help", "invite",
  "login", "logout", "new", "org", "orgs", "pricing", "product", "pulseops", "settings", "sign-in", "sign-up",
  "signin", "signup", "status", "support", "www",
]);

export const MONITOR_INTERVAL_OPTIONS = [
  { value: 30, label: "30 seconds" },
  { value: 60, label: "1 minute" },
  { value: 120, label: "2 minutes" },
  { value: 300, label: "5 minutes" },
  { value: 600, label: "10 minutes" },
  { value: 900, label: "15 minutes" },
  { value: 1800, label: "30 minutes" },
  { value: 3600, label: "1 hour" },
] as const;

export const MONITOR_LIMITS = {
  intervalSeconds: { min: 30, max: 86_400 },
  timeoutMs: { min: 1_000, max: 30_000 },
  retries: { min: 0, max: 3 },
  failureThreshold: { min: 1, max: 10 },
  recoveryThreshold: { min: 1, max: 10 },
  degradedThresholdMs: { min: 50, max: 30_000 },
  maxRedirects: 5,
} as const;

export const MONITOR_DEFAULTS = {
  kind: "WEBSITE",
  method: "GET",
  intervalSeconds: 60,
  timeoutMs: 10_000,
  expectedStatusCodes: "200-299",
  followRedirects: true,
  retries: 1,
  degradedThresholdMs: 2_000,
  failureThreshold: 3,
  recoveryThreshold: 2,
  autoIncident: true,
  incidentSeverity: "HIGH",
  enabled: true,
} as const;

/**
 * Time windows offered across the product. `bucketSeconds` is the chart
 * resolution; `source` says whether the window is served from raw checks or
 * from daily rollups (see docs/metrics.md).
 */
export const TIME_RANGES = {
  "24h": { label: "Last 24 hours", short: "24h", seconds: 86_400, bucketSeconds: 1_800, source: "raw" },
  "7d": { label: "Last 7 days", short: "7d", seconds: 7 * 86_400, bucketSeconds: 6 * 3_600, source: "raw" },
  "30d": { label: "Last 30 days", short: "30d", seconds: 30 * 86_400, bucketSeconds: 86_400, source: "daily" },
  "90d": { label: "Last 90 days", short: "90d", seconds: 90 * 86_400, bucketSeconds: 86_400, source: "daily" },
} as const;

export type TimeRange = keyof typeof TIME_RANGES;
export const TIME_RANGE_KEYS = Object.keys(TIME_RANGES) as [TimeRange, ...TimeRange[]];
export const DEFAULT_TIME_RANGE: TimeRange = "24h";

export const INCIDENT_STATUS_ORDER = ["INVESTIGATING", "IDENTIFIED", "MONITORING", "RESOLVED"] as const;
export const INCIDENT_SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;

export const INVITATION_TTL_DAYS = 7;
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
