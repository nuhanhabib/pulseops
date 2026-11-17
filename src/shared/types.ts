/**
 * The API contract.
 *
 * Every value the REST API returns is one of these DTOs. Server mappers produce
 * them, the browser consumes them, and nothing else crosses the boundary: no
 * Prisma model is ever serialized directly, so a new database column cannot
 * leak by accident.
 */
import type { TimeRange } from "./constants";
import type {
  ActivityLevel,
  ActivityType,
  AuditActorType,
  CheckErrorType,
  CheckStatus,
  DataOrigin,
  DeliveryStatus,
  HttpMethod,
  IncidentSeverity,
  IncidentSource,
  IncidentStatus,
  IncidentUpdateKind,
  MonitorKind,
  MonitorStatus,
  NotificationChannelType,
  NotificationEvent,
  OrgRole,
  StatusPageTheme,
} from "./enums";

/** ISO-8601 timestamp in UTC. */
export type ISODate = string;

// ── Envelope ────────────────────────────────────────────────────────────────

export interface ApiSuccess<T> {
  data: T;
}

export interface ApiErrorBody {
  error: {
    /** Stable, machine-readable. See docs/api.md for the full list. */
    code: string;
    message: string;
    /** Field-level validation messages, keyed by dotted path. */
    fields?: Record<string, string[]>;
    requestId: string;
  };
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

// ── Identity and tenancy ────────────────────────────────────────────────────

export interface UserRef {
  id: string;
  name: string;
  email: string;
}

export interface OrganizationDto {
  id: string;
  name: string;
  slug: string;
  isDemo: boolean;
  autoResolveIncidents: boolean;
  createdAt: ISODate;
}

export interface MembershipDto {
  organization: OrganizationDto;
  role: OrgRole;
}

export interface MeDto {
  user: UserRef & { createdAt: ISODate };
  memberships: MembershipDto[];
}

export interface SessionDto {
  id: string;
  current: boolean;
  createdAt: ISODate;
  lastUsedAt: ISODate;
  expiresAt: ISODate;
  ipAddress: string | null;
  /** Parsed, human-readable summary such as "Chrome on macOS". */
  device: string;
}

export interface MemberDto {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: OrgRole;
  joinedAt: ISODate;
  isYou: boolean;
}

export interface InvitationDto {
  id: string;
  email: string;
  role: OrgRole;
  invitedBy: string | null;
  createdAt: ISODate;
  expiresAt: ISODate;
  expired: boolean;
}

/** Returned once, at creation: the only time the raw invite link exists. */
export interface CreatedInvitationDto extends InvitationDto {
  inviteUrl: string;
  /** Whether an invitation email was queued (false when no SMTP is configured). */
  emailQueued: boolean;
}

export interface InvitationPreviewDto {
  organizationName: string;
  email: string;
  role: OrgRole;
  inviterName: string | null;
  expiresAt: ISODate;
  /** True when an account already exists for the invited address. */
  accountExists: boolean;
}

export interface NotificationPreferencesDto {
  notifyIncidentCreated: boolean;
  notifyIncidentResolved: boolean;
  notifyMonitorDown: boolean;
  notifyMonitorRecovered: boolean;
}

// ── Monitoring ──────────────────────────────────────────────────────────────

export interface MonitorDto {
  id: string;
  name: string;
  url: string;
  kind: MonitorKind;
  method: HttpMethod;
  category: string | null;
  intervalSeconds: number;
  timeoutMs: number;
  expectedStatusCodes: string;
  followRedirects: boolean;
  retries: number;
  degradedThresholdMs: number | null;
  failureThreshold: number;
  recoveryThreshold: number;
  autoIncident: boolean;
  incidentSeverity: IncidentSeverity;
  enabled: boolean;
  status: MonitorStatus;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastCheckedAt: ISODate | null;
  nextCheckAt: ISODate | null;
  lastStatusChangeAt: ISODate | null;
  lastSuccessAt: ISODate | null;
  lastFailureAt: ISODate | null;
  lastResponseTimeMs: number | null;
  lastStatusCode: number | null;
  lastErrorType: CheckErrorType | null;
  lastErrorMessage: string | null;
  isSample: boolean;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface MonitorListItemDto extends MonitorDto {
  /** Share of checks in the last 24 hours that were not DOWN, 0–100. */
  uptime24h: number | null;
  avgResponseMs24h: number | null;
  /** Hourly average response time for the last 24 hours, oldest first. */
  sparkline: (number | null)[];
  openIncidents: number;
}

export interface MonitorRef {
  id: string;
  name: string;
  status: MonitorStatus;
}

export interface CheckDto {
  id: string;
  status: CheckStatus;
  statusCode: number | null;
  responseTimeMs: number | null;
  dnsMs: number | null;
  connectMs: number | null;
  tlsMs: number | null;
  ttfbMs: number | null;
  errorType: CheckErrorType | null;
  errorMessage: string | null;
  attempts: number;
  origin: DataOrigin;
  checkedAt: ISODate;
}

/** The result of a one-off test, shown in the monitor form. Never stored. */
export interface TestCheckResultDto {
  ok: boolean;
  status: CheckStatus;
  statusCode: number | null;
  responseTimeMs: number | null;
  errorType: CheckErrorType | null;
  errorMessage: string | null;
  finalUrl: string | null;
  redirects: number;
  timings: { dnsMs: number | null; connectMs: number | null; tlsMs: number | null; ttfbMs: number | null };
}

/** One point on a time-series chart. */
export interface TimeBucketDto {
  /** Bucket start. */
  t: ISODate;
  total: number;
  up: number;
  degraded: number;
  down: number;
  /** 0–100, or null when the bucket has no checks. */
  uptime: number | null;
  avgMs: number | null;
  p95Ms: number | null;
}

export interface OutageDto {
  startedAt: ISODate;
  /** Null while the outage is still ongoing. */
  endedAt: ISODate | null;
  durationSeconds: number;
  failedChecks: number;
  errorType: CheckErrorType | null;
  errorMessage: string | null;
}

export interface MonitorStatsDto {
  range: TimeRange;
  from: ISODate;
  to: ISODate;
  bucketSeconds: number;
  /** "raw" windows are computed from individual checks; "daily" from rollups. */
  source: "raw" | "daily";
  totalChecks: number;
  failedChecks: number;
  degradedChecks: number;
  uptime: number | null;
  avgResponseMs: number | null;
  p50ResponseMs: number | null;
  p95ResponseMs: number | null;
  p99ResponseMs: number | null;
  /** failedChecks × interval. An estimate; see docs/metrics.md. */
  estimatedDowntimeSeconds: number;
  series: TimeBucketDto[];
  errorBreakdown: { errorType: CheckErrorType; count: number }[];
  /** Mean connection phases across successful checks in the window. */
  timing: { dnsMs: number | null; connectMs: number | null; tlsMs: number | null; ttfbMs: number | null } | null;
  /** Consecutive runs of failed checks. Raw windows only. */
  outages: OutageDto[];
  /** Failed checks by UTC weekday (0 = Sunday) and hour. Raw windows only. */
  failureHeatmap: { weekday: number; hour: number; failed: number; total: number }[];
  /** How much of the window is seeded sample data versus live measurements. */
  origin: { live: number; seed: number };
}

/** Daily availability, used by the 90-day uptime bar and public status pages. */
export interface DayAvailabilityDto {
  date: string;
  uptime: number | null;
  total: number;
  down: number;
  degraded: number;
}

// ── Incidents ───────────────────────────────────────────────────────────────

export interface IncidentListItemDto {
  id: string;
  number: number;
  title: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  source: IncidentSource;
  isPublic: boolean;
  isSample: boolean;
  startedAt: ISODate;
  acknowledgedAt: ISODate | null;
  resolvedAt: ISODate | null;
  updatedAt: ISODate;
  assignee: UserRef | null;
  monitors: MonitorRef[];
}

export type TimelineEntryDto =
  | {
      type: "update";
      id: string;
      kind: IncidentUpdateKind;
      status: IncidentStatus | null;
      message: string;
      isPublic: boolean;
      author: UserRef | null;
      createdAt: ISODate;
    }
  | {
      type: "note";
      id: string;
      body: string;
      author: UserRef | null;
      createdAt: ISODate;
    };

export interface IncidentDetailDto extends IncidentListItemDto {
  summary: string | null;
  createdBy: UserRef | null;
  timeline: TimelineEntryDto[];
}

export interface IncidentAnalysisContent {
  summary: string;
  possibleCauses: { cause: string; likelihood: "low" | "medium" | "high"; reasoning: string }[];
  supportingEvidence: string[];
  troubleshootingSteps: string[];
  recommendedActions: string[];
  draftUpdate: string;
  caveats: string[];
}

export interface IncidentAnalysisDto {
  id: string;
  provider: string;
  model: string;
  content: IncidentAnalysisContent;
  usage: { inputTokens: number | null; outputTokens: number | null };
  requestedBy: UserRef | null;
  isSample: boolean;
  createdAt: ISODate;
}

export interface AiStatusDto {
  enabled: boolean;
  provider: string | null;
  model: string | null;
  /** Analyses allowed per organization per hour. */
  hourlyLimit: number;
}

// ── Dashboard and analytics ─────────────────────────────────────────────────

export interface MetricWithPrevious {
  value: number | null;
  /** Same metric over the immediately preceding window of equal length. */
  previous: number | null;
}

export interface DashboardDto {
  range: TimeRange;
  from: ISODate;
  to: ISODate;
  bucketSeconds: number;
  monitors: { total: number; up: number; degraded: number; down: number; paused: number; pending: number };
  uptime: MetricWithPrevious;
  avgResponseMs: MetricWithPrevious;
  p95ResponseMs: number | null;
  checks: { total: number; failed: number };
  incidents: {
    active: number;
    opened: MetricWithPrevious;
    resolved: number;
    /** Mean time to resolve, in seconds, over incidents resolved in the window. */
    mttrSeconds: number | null;
  };
  series: TimeBucketDto[];
  origin: { live: number; seed: number };
}

export interface AnalyticsDto {
  range: TimeRange;
  from: ISODate;
  to: ISODate;
  bucketSeconds: number;
  source: "raw" | "daily";
  uptime: MetricWithPrevious;
  avgResponseMs: MetricWithPrevious;
  p95ResponseMs: number | null;
  totalChecks: number;
  failedChecks: number;
  series: TimeBucketDto[];
  /** Histogram of response times. `upToMs` is the inclusive upper bound; null = no bound. */
  responseDistribution: { label: string; upToMs: number | null; count: number }[];
  monitors: {
    id: string;
    name: string;
    kind: MonitorKind;
    status: MonitorStatus;
    totalChecks: number;
    failedChecks: number;
    uptime: number | null;
    avgResponseMs: number | null;
    p95ResponseMs: number | null;
    incidents: number;
  }[];
  incidents: {
    total: MetricWithPrevious;
    resolved: number;
    mttrSeconds: MetricWithPrevious;
    bySeverity: { severity: IncidentSeverity; count: number }[];
    /** Incidents opened per bucket, split by severity. */
    frequency: { t: ISODate; critical: number; high: number; medium: number; low: number }[];
    frequencyBucketSeconds: number;
  };
  /** Availability per UTC day across the window. */
  daily: DayAvailabilityDto[];
  /** Availability per ISO week (Monday start, UTC) across the window. */
  weekly: { weekStart: string; uptime: number | null; total: number; down: number }[];
  origin: { live: number; seed: number };
}

// ── Activity and audit ──────────────────────────────────────────────────────

export interface ActivityDto {
  id: string;
  type: ActivityType;
  level: ActivityLevel;
  title: string;
  description: string | null;
  monitorId: string | null;
  incidentId: string | null;
  isSample: boolean;
  occurredAt: ISODate;
}

export interface ActivityInboxDto extends CursorPage<ActivityDto> {
  unreadCount: number;
  seenAt: ISODate | null;
}

export interface AuditLogDto {
  id: string;
  action: string;
  actorType: AuditActorType;
  actorId: string | null;
  actorLabel: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  isSample: boolean;
  createdAt: ISODate;
}

// ── Status pages ────────────────────────────────────────────────────────────

export interface StatusPageDto {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  published: boolean;
  accentColor: string;
  theme: StatusPageTheme;
  uptimeDays: number;
  showIncidentHistory: boolean;
  supportUrl: string | null;
  monitors: {
    monitorId: string;
    /** Private name, for the editor only. */
    monitorName: string;
    displayName: string;
    description: string | null;
    status: MonitorStatus;
  }[];
  createdAt: ISODate;
  updatedAt: ISODate;
}

export type PublicComponentStatus = "operational" | "degraded" | "outage" | "unknown";
export type PublicOverallStatus = "operational" | "degraded" | "partial_outage" | "major_outage" | "unknown";

export interface PublicIncidentDto {
  id: string;
  title: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  startedAt: ISODate;
  resolvedAt: ISODate | null;
  /** Public display names of affected components on this page. */
  components: string[];
  updates: { id: string; status: IncidentStatus | null; message: string; createdAt: ISODate }[];
}

/**
 * Everything a public status page exposes. Deliberately its own shape, built
 * by its own query: there is no private DTO here to forget to strip.
 */
export interface PublicStatusPageDto {
  name: string;
  description: string | null;
  accentColor: string;
  theme: StatusPageTheme;
  supportUrl: string | null;
  uptimeDays: number;
  overall: PublicOverallStatus;
  generatedAt: ISODate;
  components: {
    name: string;
    description: string | null;
    status: PublicComponentStatus;
    uptime: number | null;
    days: { date: string; uptime: number | null }[];
  }[];
  activeIncidents: PublicIncidentDto[];
  pastIncidents: PublicIncidentDto[];
  /** True when any figure on the page derives from seeded sample data. */
  containsSampleData: boolean;
}

// ── Notifications ───────────────────────────────────────────────────────────

export interface NotificationChannelDto {
  id: string;
  type: NotificationChannelType;
  name: string;
  enabled: boolean;
  events: NotificationEvent[];
  /** EMAIL only. */
  recipients: string[];
  /** WEBHOOK only. */
  url: string | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

/** Returned once, when a webhook channel is created or its secret is rotated. */
export interface CreatedChannelDto extends NotificationChannelDto {
  signingSecret: string | null;
}

export interface NotificationDeliveryDto {
  id: string;
  channelType: NotificationChannelType;
  channelName: string | null;
  /** Masked: "a•••@example.com" or the webhook's host. */
  destination: string;
  event: NotificationEvent;
  subject: string;
  status: DeliveryStatus;
  attempts: number;
  lastError: string | null;
  incident: { id: string; number: number } | null;
  monitor: { id: string; name: string } | null;
  createdAt: ISODate;
  sentAt: ISODate | null;
}

export interface NotificationSettingsDto {
  /** Whether an SMTP provider is configured on this deployment. */
  emailConfigured: boolean;
  emailFrom: string | null;
  preferences: NotificationPreferencesDto;
  channels: NotificationChannelDto[];
}

// ── Global search ───────────────────────────────────────────────────────────

export interface SearchResultsDto {
  monitors: { id: string; name: string; url: string; status: MonitorStatus }[];
  incidents: { id: string; number: number; title: string; status: IncidentStatus; severity: IncidentSeverity }[];
  statusPages: { id: string; name: string; slug: string; published: boolean }[];
}
