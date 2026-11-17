/**
 * Demo workspace seed.
 *
 * Produces one organization ("Northwind Demo") that looks like a team has been
 * using PulseOps for three months: monitors, 90 days of availability, a week
 * of individual checks, incidents with timelines, a public status page,
 * notification history, and an audit trail.
 *
 * Honesty rules:
 *   - Every fabricated row is tagged (`origin = SEED` or `isSample = true`)
 *     and the UI labels it as sample data.
 *   - Monitors point at the bundled simulator (scripts/demo-targets.ts), so
 *     everything recorded *after* seeding is a real check result.
 *   - The generator is a seeded PRNG: the same shape of data every run, with
 *     timestamps relative to "now" so the charts are always current.
 *
 * Idempotent: it deletes and recreates the demo organization and its users.
 */
import "../src/server/load-env";

import { hashPassword } from "../src/server/auth/password";
import { prisma } from "../src/server/db";
import { rollupDailyAggregates } from "../src/server/modules/metrics/queries";
import { DEMO_SERVICES, demoTargetUrl, type DemoService } from "../scripts/demo-services";

const DEMO_SLUG = "northwind-demo";
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "pulseops-demo-2026";
const TARGETS_URL = process.env.DEMO_TARGETS_URL ?? "http://localhost:4010";
const RAW_DAYS = 7;
const HISTORY_DAYS = 90;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** mulberry32: small, fast, deterministic. */
function createRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const USERS = [
  { key: "owner", email: "demo@northwind.example", name: "Avery Chen", role: "OWNER" },
  { key: "admin", email: "priya@northwind.example", name: "Priya Raman", role: "ADMIN" },
  { key: "member", email: "marcus@northwind.example", name: "Marcus Oyelaran", role: "MEMBER" },
  { key: "viewer", email: "sofia@northwind.example", name: "Sofia Lindqvist", role: "VIEWER" },
] as const;

type ErrorKind = "TIMEOUT" | "HTTP_STATUS" | "CONNECTION" | "TLS" | "DNS";
const ERROR_TEXT: Record<ErrorKind, string> = {
  TIMEOUT: "No response within the configured timeout.",
  HTTP_STATUS: "Received HTTP 503; expected 200-299.",
  CONNECTION: "Connection failed: connection refused.",
  TLS: "TLS error: the certificate has expired.",
  DNS: "DNS lookup failed (ENOTFOUND).",
};

/** Scripted outages inside the raw-check window. `hoursAgo` is when the outage began. */
const OUTAGES: { slug: string; hoursAgo: number; minutes: number; error: ErrorKind }[] = [
  { slug: "checkout-api", hoursAgo: 150, minutes: 26, error: "HTTP_STATUS" },
  { slug: "search-api", hoursAgo: 118, minutes: 41, error: "TIMEOUT" },
  { slug: "payments-gateway", hoursAgo: 76, minutes: 14, error: "CONNECTION" },
  { slug: "notifications-api", hoursAgo: 52, minutes: 58, error: "HTTP_STATUS" },
  { slug: "auth-service", hoursAgo: 29, minutes: 9, error: "TIMEOUT" },
  { slug: "storefront", hoursAgo: 11, minutes: 7, error: "HTTP_STATUS" },
];

/** Periods of elevated latency (no failures). */
const SLOWDOWNS: { slug: string; hoursAgo: number; minutes: number; factor: number }[] = [
  { slug: "search-api", hoursAgo: 6, minutes: 95, factor: 3.6 },
  { slug: "checkout-api", hoursAgo: 96, minutes: 70, factor: 3.1 },
  { slug: "reports-export", hoursAgo: 40, minutes: 240, factor: 1.6 },
];

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") {
    throw new Error("Refusing to seed demo data with NODE_ENV=production. Set ALLOW_DEMO_SEED=true to override.");
  }
  // Used by Docker Compose so a restart does not wipe a workspace someone is exploring.
  if (process.argv.includes("--if-empty") && (await prisma.organization.count({ where: { slug: DEMO_SLUG } })) > 0) {
    console.log("Demo workspace already present; leaving it untouched.");
    return;
  }
  const random = createRandom(20260101);
  const gaussian = () => (random() + random() + random() + random() - 2) / 2;
  const now = new Date();
  const started = Date.now();

  // ── Reset ─────────────────────────────────────────────────────────────────
  await prisma.organization.deleteMany({ where: { slug: DEMO_SLUG } });
  await prisma.user.deleteMany({ where: { email: { in: USERS.map((user) => user.email) } } });

  // ── Users and organization ────────────────────────────────────────────────
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const users: Record<string, { id: string; name: string; email: string }> = {};
  for (const user of USERS) {
    users[user.key] = await prisma.user.create({
      data: { email: user.email, name: user.name, passwordHash, createdAt: new Date(now.getTime() - 100 * DAY) },
      select: { id: true, name: true, email: true },
    });
  }
  const owner = users.owner!, admin = users.admin!, member = users.member!;

  const org = await prisma.organization.create({
    data: {
      name: "Northwind Demo", slug: DEMO_SLUG, isDemo: true, createdAt: new Date(now.getTime() - 98 * DAY),
      members: {
        create: USERS.map((user, index) => ({
          userId: users[user.key]!.id, role: user.role, createdAt: new Date(now.getTime() - (98 - index * 6) * DAY),
          activitySeenAt: new Date(now.getTime() - 14 * HOUR),
        })),
      },
    },
  });

  // ── Monitors ──────────────────────────────────────────────────────────────
  const monitors = new Map<string, { id: string; service: DemoService }>();
  for (const service of DEMO_SERVICES) {
    const paused = service.slug === "admin-console";
    const monitor = await prisma.monitor.create({
      data: {
        organizationId: org.id, name: service.name, url: demoTargetUrl(TARGETS_URL, service.slug), kind: service.kind, method: service.method,
        category: service.category, intervalSeconds: service.intervalSeconds, timeoutMs: 8000, expectedStatusCodes: "200-299",
        retries: 1, degradedThresholdMs: service.degradedThresholdMs, failureThreshold: 3, recoveryThreshold: 2,
        incidentSeverity: service.severity, enabled: !paused, status: paused ? "PAUSED" : "UP", isSample: true,
        createdById: service.category === "Internal" ? member.id : admin.id, createdAt: new Date(now.getTime() - 95 * DAY),
        // Stagger the first live checks so they do not all land in the same second.
        nextCheckAt: new Date(now.getTime() + Math.floor(random() * 20_000)),
      },
    });
    monitors.set(service.slug, { id: monitor.id, service });
  }

  // ── Raw checks for the last week ──────────────────────────────────────────
  const rawStart = now.getTime() - RAW_DAYS * DAY;
  type CheckRow = {
    monitorId: string; organizationId: string; status: "UP" | "DEGRADED" | "DOWN"; statusCode: number | null; responseTimeMs: number | null;
    dnsMs: number | null; connectMs: number | null; tlsMs: number | null; ttfbMs: number | null;
    errorType: ErrorKind | null; errorMessage: string | null; attempts: number; origin: "SEED"; checkedAt: Date;
  };
  let checkCount = 0;
  const lastState = new Map<string, { at: Date; ms: number | null; status: string; lastFailure: Date | null }>();

  for (const [slug, { id, service }] of monitors) {
    if (slug === "admin-console") continue;
    const outages = OUTAGES.filter((outage) => outage.slug === slug).map((outage) => ({
      from: now.getTime() - outage.hoursAgo * HOUR, to: now.getTime() - outage.hoursAgo * HOUR + outage.minutes * MINUTE, error: outage.error,
    }));
    const slowdowns = SLOWDOWNS.filter((item) => item.slug === slug).map((item) => ({
      from: now.getTime() - item.hoursAgo * HOUR, to: now.getTime() - item.hoursAgo * HOUR + item.minutes * MINUTE, factor: item.factor,
    }));
    const rows: CheckRow[] = [];
    let lastFailure: Date | null = null;
    const step = service.intervalSeconds * 1000;

    for (let t = rawStart + Math.floor(random() * step); t < now.getTime() - 20_000; t += step) {
      const at = new Date(t + Math.floor((random() - 0.5) * 1500));
      const outage = outages.find((window) => t >= window.from && t < window.to);
      const blip = !outage && random() < service.errorRate;
      if (outage || blip) {
        const error: ErrorKind = outage?.error ?? "HTTP_STATUS";
        lastFailure = at;
        rows.push({
          monitorId: id, organizationId: org.id, status: "DOWN", statusCode: error === "HTTP_STATUS" ? 503 : null,
          responseTimeMs: error === "HTTP_STATUS" ? Math.round(service.latencyMs * (0.8 + random() * 0.5)) : null,
          dnsMs: null, connectMs: null, tlsMs: null, ttfbMs: null, errorType: error, errorMessage: ERROR_TEXT[error],
          attempts: 2, origin: "SEED", checkedAt: at,
        });
        continue;
      }
      // Daily rhythm: slower in the UTC afternoon, when traffic peaks.
      const hour = at.getUTCHours() + at.getUTCMinutes() / 60;
      const rhythm = 1 + 0.18 * Math.sin(((hour - 9) / 24) * 2 * Math.PI);
      const slow = slowdowns.find((window) => t >= window.from && t < window.to);
      const spike = random() < 0.012 ? 1.8 + random() * 2.2 : 1;
      const ms = Math.max(8, Math.round(service.latencyMs * rhythm * (1 + gaussian() * 0.22) * spike * (slow?.factor ?? 1)));
      const dns = Math.max(1, Math.round(4 + random() * 14));
      const connect = Math.max(1, Math.round(6 + random() * 18));
      rows.push({
        monitorId: id, organizationId: org.id, status: ms > service.degradedThresholdMs ? "DEGRADED" : "UP", statusCode: 200, responseTimeMs: ms,
        dnsMs: dns, connectMs: connect, tlsMs: null, ttfbMs: Math.max(1, ms - dns - connect),
        errorType: null, errorMessage: null, attempts: 1, origin: "SEED", checkedAt: at,
      });
    }

    for (let index = 0; index < rows.length; index += 4000) {
      await prisma.monitorCheck.createMany({ data: rows.slice(index, index + 4000) });
    }
    checkCount += rows.length;
    const last = rows[rows.length - 1];
    if (last) lastState.set(slug, { at: last.checkedAt, ms: last.responseTimeMs, status: last.status, lastFailure });
  }

  for (const [slug, { id }] of monitors) {
    const state = lastState.get(slug);
    if (!state) continue;
    await prisma.monitor.update({
      where: { id },
      data: {
        status: state.status === "DOWN" ? "DEGRADED" : (state.status as "UP" | "DEGRADED"), lastCheckedAt: state.at, lastSuccessAt: state.at,
        lastFailureAt: state.lastFailure, lastResponseTimeMs: state.ms, lastStatusCode: 200, consecutiveSuccesses: 5,
        lastStatusChangeAt: new Date(now.getTime() - (2 + Math.floor(random() * 30)) * HOUR),
      },
    });
  }

  // ── Daily rollups: the last week from the checks above, the rest generated ─
  await rollupDailyAggregates(new Date(rawStart - DAY));
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const aggregateRows = [];
  for (const [slug, { id, service }] of monitors) {
    if (slug === "admin-console") continue;
    const perDay = Math.floor(86_400 / service.intervalSeconds);
    for (let offset = RAW_DAYS + 1; offset < HISTORY_DAYS; offset++) {
      // Most days are clean; a few carry a short outage, rarely a long one.
      const roll = random();
      const downShare = roll < 0.9 ? service.errorRate : roll < 0.985 ? 0.004 + random() * 0.02 : 0.03 + random() * 0.07;
      const down = Math.min(perDay, Math.round(perDay * downShare));
      const avg = Math.round(service.latencyMs * (0.92 + random() * 0.2));
      const degraded = Math.round((perDay - down) * (avg * 2.2 > service.degradedThresholdMs ? 0.03 + random() * 0.05 : random() * 0.006));
      aggregateRows.push({
        monitorId: id, organizationId: org.id, day: new Date(today - offset * DAY), totalChecks: perDay, upChecks: perDay - down - degraded,
        degradedChecks: degraded, downChecks: down, avgResponseMs: avg, minResponseMs: Math.round(avg * 0.55), maxResponseMs: Math.round(avg * (2.8 + random() * 2)),
        p50ResponseMs: Math.round(avg * 0.94), p95ResponseMs: Math.round(avg * (1.5 + random() * 0.4)), p99ResponseMs: Math.round(avg * (2.1 + random() * 0.6)),
        origin: "SEED" as const,
      });
    }
  }
  await prisma.monitorDailyAggregate.createMany({ data: aggregateRows, skipDuplicates: true });

  // ── Incidents ─────────────────────────────────────────────────────────────
  type Update = { minutes: number; kind: "UPDATE" | "SYSTEM"; status?: "INVESTIGATING" | "IDENTIFIED" | "MONITORING" | "RESOLVED"; message: string; by?: string; isPublic?: boolean };
  type IncidentSeed = {
    title: string; summary: string; severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"; source: "MANUAL" | "AUTOMATED"; hoursAgo: number;
    durationMinutes: number | null; status: "INVESTIGATING" | "IDENTIFIED" | "MONITORING" | "RESOLVED"; monitors: string[]; assignee?: string;
    createdBy?: string; isPublic: boolean; updates: Update[]; notes?: { minutes: number; by: string; body: string }[];
  };

  const auto = (slug: string, error: ErrorKind): Update => ({
    minutes: 0, kind: "SYSTEM", status: "INVESTIGATING",
    message: `Incident opened automatically. ${monitors.get(slug)!.service.name} failed 3 consecutive checks. Last error: ${ERROR_TEXT[error]}`,
  });

  const incidentSeeds: IncidentSeed[] = [
    {
      title: "Intermittent 5xx responses from Reports Export", summary: "Scheduled exports are failing for a subset of large accounts.",
      severity: "LOW", source: "MANUAL", hoursAgo: 60 * 24, durationMinutes: 190, status: "RESOLVED", monitors: ["reports-export"], assignee: "member", createdBy: "member", isPublic: false,
      updates: [
        { minutes: 0, kind: "SYSTEM", status: "INVESTIGATING", message: "Incident opened by Marcus Oyelaran." },
        { minutes: 35, kind: "UPDATE", status: "IDENTIFIED", by: "member", message: "Exports over 50k rows exhaust the worker's memory limit and are killed mid-run." },
        { minutes: 190, kind: "UPDATE", status: "RESOLVED", by: "member", message: "Raised the memory limit and switched large exports to streaming. Backlog has drained." },
      ],
    },
    {
      title: "Payments Gateway is down", summary: "Opened automatically after 3 consecutive failed checks.",
      severity: "CRITICAL", source: "AUTOMATED", hoursAgo: 33 * 24, durationMinutes: 47, status: "RESOLVED", monitors: ["payments-gateway", "checkout-api"], assignee: "admin", isPublic: true,
      updates: [
        auto("payments-gateway", "CONNECTION"),
        { minutes: 6, kind: "UPDATE", by: "admin", isPublic: true, message: "We are investigating failed card payments. Customers may see an error at checkout." },
        { minutes: 19, kind: "UPDATE", status: "IDENTIFIED", by: "admin", isPublic: true, message: "A network change at our payment processor is rejecting our connections. We are failing over to the secondary region." },
        { minutes: 31, kind: "UPDATE", status: "MONITORING", by: "admin", isPublic: true, message: "Failover is complete and payments are succeeding again. We are monitoring for stability." },
        { minutes: 47, kind: "SYSTEM", status: "RESOLVED", message: "Resolved automatically. Payments Gateway recovered after 47 minutes and all linked monitors are healthy." },
      ],
      notes: [
        { minutes: 12, by: "admin", body: "Processor status page shows nothing yet. Opened a P1 with their support, ticket is in the shared channel." },
        { minutes: 34, by: "member", body: "Refund queue had 212 stuck jobs. Requeued them after failover; all cleared." },
      ],
    },
    {
      title: "Elevated login failures", summary: "A share of sign-in attempts are returning errors.",
      severity: "HIGH", source: "MANUAL", hoursAgo: 19 * 24, durationMinutes: 64, status: "RESOLVED", monitors: ["auth-service"], assignee: "owner", createdBy: "owner", isPublic: true,
      updates: [
        { minutes: 0, kind: "SYSTEM", status: "INVESTIGATING", message: "Incident opened by Avery Chen." },
        { minutes: 4, kind: "UPDATE", by: "owner", isPublic: true, message: "Some users are unable to sign in. We are investigating." },
        { minutes: 28, kind: "UPDATE", status: "IDENTIFIED", by: "owner", isPublic: true, message: "A session-store node ran out of connections after a deploy. We are rolling the change back." },
        { minutes: 64, kind: "UPDATE", status: "RESOLVED", by: "owner", isPublic: true, message: "The rollback is complete and sign-in success rates are back to normal." },
      ],
    },
    ...OUTAGES.map((outage): IncidentSeed => {
      const service = monitors.get(outage.slug)!.service;
      return {
        title: `${service.name} is down`, summary: "Opened automatically after 3 consecutive failed checks.", severity: service.severity,
        source: "AUTOMATED", hoursAgo: outage.hoursAgo - (3 * service.intervalSeconds) / 3600, durationMinutes: outage.minutes, status: "RESOLVED",
        monitors: [outage.slug], assignee: outage.minutes > 20 ? "admin" : undefined, isPublic: outage.minutes > 20,
        updates: [
          auto(outage.slug, outage.error),
          ...(outage.minutes > 20
            ? [{ minutes: 8, kind: "UPDATE" as const, status: "IDENTIFIED" as const, by: "admin", isPublic: true, message: `We have identified the cause of the ${service.name} disruption and are applying a fix.` }]
            : []),
          { minutes: outage.minutes, kind: "SYSTEM", status: "RESOLVED", message: `Resolved automatically. ${service.name} recovered after ${outage.minutes} minutes and all linked monitors are healthy.` },
        ],
      };
    }),
    {
      title: "Search results loading slowly", summary: "p95 latency on the Search API is several times its normal level.",
      severity: "MEDIUM", source: "MANUAL", hoursAgo: 5.5, durationMinutes: null, status: "MONITORING", monitors: ["search-api"], assignee: "member", createdBy: "member", isPublic: true,
      updates: [
        { minutes: 0, kind: "SYSTEM", status: "INVESTIGATING", message: "Incident opened by Marcus Oyelaran." },
        { minutes: 9, kind: "UPDATE", by: "member", isPublic: true, message: "Search is responding more slowly than usual. Results still load, but may take a few seconds." },
        { minutes: 52, kind: "UPDATE", status: "IDENTIFIED", by: "member", isPublic: true, message: "A reindexing job is competing with live queries for capacity. We have throttled the job." },
        { minutes: 110, kind: "UPDATE", status: "MONITORING", by: "member", isPublic: true, message: "Response times are back within normal range. We are keeping an eye on it while the reindex finishes." },
      ],
      notes: [{ minutes: 60, by: "admin", body: "Reindex was kicked off by the nightly job running 6h late after last week's scheduler change. Worth a follow-up to stop it overlapping with peak." }],
    },
    {
      title: "Delayed delivery of email notifications", summary: "Transactional emails are queuing and arriving late.",
      severity: "LOW", source: "MANUAL", hoursAgo: 1.4, durationMinutes: null, status: "IDENTIFIED", monitors: ["notifications-api"], assignee: "admin", createdBy: "admin", isPublic: false,
      updates: [
        { minutes: 0, kind: "SYSTEM", status: "INVESTIGATING", message: "Incident opened by Priya Raman." },
        { minutes: 22, kind: "UPDATE", status: "IDENTIFIED", by: "admin", message: "Our email provider is rate limiting us after a large campaign send. Queue depth is about 14k and draining." },
      ],
    },
  ];

  incidentSeeds.sort((a, b) => b.hoursAgo - a.hoursAgo);
  const incidentIds: { id: string; number: number; seed: IncidentSeed; startedAt: Date }[] = [];
  let number = 0;
  for (const seed of incidentSeeds) {
    number += 1;
    const startedAt = new Date(now.getTime() - seed.hoursAgo * HOUR);
    const resolvedAt = seed.durationMinutes === null ? null : new Date(startedAt.getTime() + seed.durationMinutes * MINUTE);
    const incident = await prisma.incident.create({
      data: {
        organizationId: org.id, number, title: seed.title, summary: seed.summary, status: seed.status, severity: seed.severity, source: seed.source,
        isPublic: seed.isPublic, isSample: true, assigneeId: seed.assignee ? users[seed.assignee]!.id : null,
        createdById: seed.createdBy ? users[seed.createdBy]!.id : null, startedAt, resolvedAt,
        acknowledgedAt: seed.updates.find((update) => update.by) ? new Date(startedAt.getTime() + 4 * MINUTE) : null,
        createdAt: startedAt, updatedAt: resolvedAt ?? new Date(startedAt.getTime() + (seed.updates.at(-1)?.minutes ?? 0) * MINUTE),
        monitors: { create: seed.monitors.map((slug) => ({ monitorId: monitors.get(slug)!.id, organizationId: org.id })) },
        updates: {
          create: seed.updates.map((update) => ({
            organizationId: org.id, kind: update.kind, status: update.status ?? null, message: update.message,
            isPublic: Boolean(update.isPublic) && seed.isPublic, authorId: update.by ? users[update.by]!.id : null,
            createdAt: new Date(startedAt.getTime() + update.minutes * MINUTE),
          })),
        },
        notes: {
          create: (seed.notes ?? []).map((note) => ({
            organizationId: org.id, authorId: users[note.by]!.id, body: note.body, createdAt: new Date(startedAt.getTime() + note.minutes * MINUTE),
          })),
        },
      },
    });
    incidentIds.push({ id: incident.id, number, seed, startedAt });
  }
  await prisma.organization.update({ where: { id: org.id }, data: { incidentCounter: number } });

  // A stored example of an AI analysis, so the feature can be explored without an API key.
  const searchIncident = incidentIds.find((item) => item.seed.title.startsWith("Search results"));
  if (searchIncident) {
    await prisma.incidentAnalysis.create({
      data: {
        incidentId: searchIncident.id, organizationId: org.id, provider: "sample", model: "seeded-example", isSample: true,
        requestedById: member.id, createdAt: new Date(searchIncident.startedAt.getTime() + 40 * MINUTE),
        content: {
          summary: "Monitor A is still answering every check, but responses in the last hour are roughly three to four times slower than in the hour before. There are no failed checks, so this is a latency problem rather than an outage.",
          possibleCauses: [
            { cause: "Resource contention on the service or its data store", likelihood: "high", reasoning: "Latency rose sharply while the error rate stayed at zero, which is the usual signature of saturation rather than a fault." },
            { cause: "A slow downstream dependency", likelihood: "medium", reasoning: "Time to first byte accounts for the whole increase; connection setup is unchanged. A dependency adding latency would look the same from outside." },
            { cause: "A network path problem between the monitor and the service", likelihood: "low", reasoning: "DNS and connect timings are flat, which makes a network cause unlikely." },
          ],
          supportingEvidence: [
            "Average response time moved from about 310 ms to over 1,100 ms between the two hourly windows.",
            "0 failed checks in either window.",
            "The increase is entirely in time to first byte; DNS and TCP connect are unchanged.",
          ],
          troubleshootingSteps: [
            "Compare CPU, memory, and connection-pool saturation on the service against the same hour yesterday.",
            "Check for batch or maintenance jobs that started shortly before latency rose.",
            "Look at latency for the service's own dependencies over the same period.",
          ],
          recommendedActions: [
            "Assign an owner and post a customer-facing update, since users will notice slow results.",
            "If a background job is competing for capacity, throttle or reschedule it rather than restarting the service.",
          ],
          draftUpdate: "Search is responding more slowly than usual. Results still load, but may take a few seconds longer. We have identified the likely cause and are working to bring response times back to normal.",
          caveats: [
            "These are external HTTP checks from a single location. They show symptoms, not what is happening inside the service.",
            "No logs, traces, or deploy history were available to this analysis.",
          ],
        },
      },
    });
  }

  // ── Activity feed ─────────────────────────────────────────────────────────
  const activity = [];
  for (const { id, number: incidentNumber, seed, startedAt } of incidentIds) {
    const monitorId = monitors.get(seed.monitors[0]!)!.id;
    const monitorName = monitors.get(seed.monitors[0]!)!.service.name;
    const critical = seed.severity === "CRITICAL" || seed.severity === "HIGH";
    if (seed.source === "AUTOMATED") {
      activity.push({ type: "MONITOR_DOWN" as const, level: "CRITICAL" as const, title: `${monitorName} is down`, description: seed.updates[0]!.message.split("Last error: ")[1] ?? null, monitorId, incidentId: null, occurredAt: startedAt });
    }
    activity.push({ type: "INCIDENT_OPENED" as const, level: critical ? ("CRITICAL" as const) : ("WARNING" as const), title: `INC-${incidentNumber} opened: ${seed.title}`, description: seed.source === "AUTOMATED" ? "Opened automatically." : `Opened by ${users[seed.createdBy ?? "owner"]!.name}.`, monitorId, incidentId: id, occurredAt: new Date(startedAt.getTime() + 1000) });
    if (seed.durationMinutes !== null) {
      const end = new Date(startedAt.getTime() + seed.durationMinutes * MINUTE);
      if (seed.source === "AUTOMATED") {
        activity.push({ type: "MONITOR_RECOVERED" as const, level: "SUCCESS" as const, title: `${monitorName} recovered`, description: `Down for ${seed.durationMinutes} minutes.`, monitorId, incidentId: null, occurredAt: end });
      }
      activity.push({ type: "INCIDENT_RESOLVED" as const, level: "SUCCESS" as const, title: `INC-${incidentNumber} resolved: ${seed.title}`, description: seed.source === "AUTOMATED" ? "Resolved automatically after recovery." : "Resolved by the team.", monitorId, incidentId: id, occurredAt: new Date(end.getTime() + 1000) });
    }
  }
  for (const slow of SLOWDOWNS) {
    const target = monitors.get(slow.slug)!;
    activity.push({ type: "MONITOR_DEGRADED" as const, level: "WARNING" as const, title: `${target.service.name} is degraded`, description: `Responding slowly (${Math.round(target.service.latencyMs * slow.factor)} ms).`, monitorId: target.id, incidentId: null, occurredAt: new Date(now.getTime() - slow.hoursAgo * HOUR) });
  }
  activity.push({ type: "MONITOR_PAUSED" as const, level: "INFO" as const, title: "Admin Console was paused", description: "By Priya Raman.", monitorId: monitors.get("admin-console")!.id, incidentId: null, occurredAt: new Date(now.getTime() - 3 * DAY) });
  await prisma.activityEvent.createMany({ data: activity.map((item) => ({ ...item, organizationId: org.id, isSample: true })) });

  // ── Status page ───────────────────────────────────────────────────────────
  const publicServices = DEMO_SERVICES.filter((service) => service.publicName);
  await prisma.statusPage.create({
    data: {
      organizationId: org.id, slug: "northwind", name: "Northwind Status", published: true, accentColor: "#6366f1",
      description: "Live status and incident history for Northwind's customer-facing services.", supportUrl: "https://support.northwind.example",
      createdAt: new Date(now.getTime() - 80 * DAY),
      monitors: {
        create: publicServices.map((service, index) => ({
          monitorId: monitors.get(service.slug)!.id, displayName: service.publicName!, sortOrder: index,
          description: service.slug === "checkout-api" ? "Cart, checkout, and order placement" : service.slug === "auth-service" ? "Sign-in and account access" : null,
        })),
      },
    },
  });
  await prisma.statusPage.create({
    data: { organizationId: org.id, slug: "northwind-internal", name: "Internal Tools", published: false, accentColor: "#0ea5e9", description: "Draft page for internal systems.",
      monitors: { create: [{ monitorId: monitors.get("reports-export")!.id, displayName: "Reports", sortOrder: 0 }, { monitorId: monitors.get("admin-console")!.id, displayName: "Admin Console", sortOrder: 1 }] } },
  });

  // ── Notification channels and delivery history ────────────────────────────
  const emailChannel = await prisma.notificationChannel.create({
    data: { organizationId: org.id, type: "EMAIL", name: "On-call list", config: { recipients: ["oncall@northwind.example"] }, events: ["INCIDENT_CREATED", "INCIDENT_RESOLVED", "MONITOR_DOWN"], createdById: admin.id, createdAt: new Date(now.getTime() - 70 * DAY) },
  });
  const webhookChannel = await prisma.notificationChannel.create({
    // Disabled: the address is a placeholder, and enabling it would produce failed deliveries.
    data: { organizationId: org.id, type: "WEBHOOK", name: "Ops automation hook", enabled: false, config: { url: "https://hooks.northwind.example/pulseops" }, signingSecret: "whsec_sample_not_a_real_secret", events: ["INCIDENT_CREATED", "INCIDENT_RESOLVED"], createdById: admin.id, createdAt: new Date(now.getTime() - 40 * DAY) },
  });
  const deliveries = [];
  for (const { id, number: incidentNumber, seed, startedAt } of incidentIds.slice(-7)) {
    const base = { organizationId: org.id, incidentId: id, monitorId: monitors.get(seed.monitors[0]!)!.id, channelType: "EMAIL" as const, payload: { sample: true } };
    deliveries.push({ ...base, channelId: emailChannel.id, recipient: "oncall@northwind.example", event: "INCIDENT_CREATED" as const, dedupeKey: `seed:created:${id}:oncall`, subject: `[${seed.severity}] INC-${incidentNumber}: ${seed.title}`, status: "SENT" as const, attempts: 1, createdAt: startedAt, sentAt: new Date(startedAt.getTime() + 2400) });
    deliveries.push({ ...base, userId: owner.id, recipient: owner.email, event: "INCIDENT_CREATED" as const, dedupeKey: `seed:created:${id}:owner`, subject: `[${seed.severity}] INC-${incidentNumber}: ${seed.title}`, status: "SENT" as const, attempts: 1, createdAt: startedAt, sentAt: new Date(startedAt.getTime() + 3100) });
    if (seed.durationMinutes !== null) {
      const end = new Date(startedAt.getTime() + seed.durationMinutes * MINUTE);
      deliveries.push({ ...base, channelId: emailChannel.id, recipient: "oncall@northwind.example", event: "INCIDENT_RESOLVED" as const, dedupeKey: `seed:resolved:${id}:oncall`, subject: `[Resolved] INC-${incidentNumber}: ${seed.title}`, status: "SENT" as const, attempts: seed.severity === "CRITICAL" ? 2 : 1, createdAt: end, sentAt: new Date(end.getTime() + 2900) });
    }
  }
  const firstIncident = incidentIds[1];
  if (firstIncident) {
    deliveries.push({ organizationId: org.id, incidentId: firstIncident.id, monitorId: null as unknown as string, channelType: "WEBHOOK" as const, channelId: webhookChannel.id, payload: { sample: true }, recipient: "https://hooks.northwind.example/pulseops", event: "INCIDENT_CREATED" as const, dedupeKey: `seed:created:${firstIncident.id}:hook`, subject: `[CRITICAL] INC-${firstIncident.number}: ${firstIncident.seed.title}`, status: "FAILED" as const, attempts: 5, lastError: "DNS lookup failed (ENOTFOUND).", createdAt: firstIncident.startedAt, sentAt: null as unknown as Date });
  }
  await prisma.notificationDelivery.createMany({ data: deliveries });

  // ── Audit trail ───────────────────────────────────────────────────────────
  const audit: { actor: string | null; action: string; targetType: string; targetLabel: string; daysAgo: number; metadata?: object }[] = [
    { actor: "owner", action: "organization.created", targetType: "organization", targetLabel: "Northwind Demo", daysAgo: 98 },
    { actor: "owner", action: "member.invited", targetType: "invitation", targetLabel: admin.email, daysAgo: 92, metadata: { role: "ADMIN" } },
    { actor: "admin", action: "member.joined", targetType: "member", targetLabel: admin.email, daysAgo: 92, metadata: { role: "ADMIN" } },
    ...DEMO_SERVICES.slice(0, 5).map((service, index) => ({ actor: "admin", action: "monitor.created", targetType: "monitor", targetLabel: service.name, daysAgo: 95 - index * 0.01, metadata: { intervalSeconds: service.intervalSeconds } })),
    { actor: "owner", action: "member.invited", targetType: "invitation", targetLabel: member.email, daysAgo: 86, metadata: { role: "MEMBER" } },
    { actor: "member", action: "member.joined", targetType: "member", targetLabel: member.email, daysAgo: 86, metadata: { role: "MEMBER" } },
    { actor: "admin", action: "status_page.created", targetType: "status_page", targetLabel: "Northwind Status", daysAgo: 80, metadata: { slug: "northwind" } },
    { actor: "admin", action: "status_page.published", targetType: "status_page", targetLabel: "Northwind Status", daysAgo: 79 },
    { actor: "admin", action: "notification_channel.created", targetType: "notification_channel", targetLabel: "On-call list", daysAgo: 70, metadata: { type: "EMAIL" } },
    { actor: "owner", action: "member.role_changed", targetType: "member", targetLabel: users.viewer!.email, daysAgo: 55, metadata: { from: "MEMBER", to: "VIEWER" } },
    { actor: "admin", action: "monitor.updated", targetType: "monitor", targetLabel: "Checkout API", daysAgo: 44, metadata: { changes: { intervalSeconds: { from: 60, to: 30 } } } },
    { actor: "admin", action: "notification_channel.created", targetType: "notification_channel", targetLabel: "Ops automation hook", daysAgo: 40, metadata: { type: "WEBHOOK" } },
    { actor: "owner", action: "organization.updated", targetType: "organization", targetLabel: "Northwind Demo", daysAgo: 21, metadata: { changes: { autoResolveIncidents: { from: false, to: true } } } },
    { actor: "member", action: "monitor.updated", targetType: "monitor", targetLabel: "Reports Export", daysAgo: 12, metadata: { changes: { degradedThresholdMs: { from: 1200, to: 1500 } } } },
    { actor: "admin", action: "monitor.paused", targetType: "monitor", targetLabel: "Admin Console", daysAgo: 3, metadata: { changes: { enabled: { from: true, to: false } } } },
    ...incidentIds.slice(-6).flatMap(({ number: incidentNumber, seed, startedAt }) => {
      const daysAgo = (now.getTime() - startedAt.getTime()) / DAY;
      return [
        { actor: seed.createdBy ?? null, action: "incident.created", targetType: "incident", targetLabel: `INC-${incidentNumber}`, daysAgo, metadata: { source: seed.source === "AUTOMATED" ? "automation" : "manual", title: seed.title } },
        ...(seed.durationMinutes !== null ? [{ actor: seed.source === "AUTOMATED" ? null : (seed.createdBy ?? null), action: "incident.resolved", targetType: "incident", targetLabel: `INC-${incidentNumber}`, daysAgo: daysAgo - seed.durationMinutes / 1440 }] : []),
      ];
    }),
  ];
  await prisma.auditLog.createMany({
    data: audit.map((entry) => ({
      organizationId: org.id, actorType: entry.actor ? ("USER" as const) : ("SYSTEM" as const), actorId: entry.actor ? users[entry.actor]!.id : null,
      actorLabel: entry.actor ? users[entry.actor]!.email : "PulseOps automation", action: entry.action, targetType: entry.targetType,
      targetLabel: entry.targetLabel, metadata: entry.metadata ?? undefined, ipAddress: entry.actor ? "203.0.113.24" : null, isSample: true,
      createdAt: new Date(now.getTime() - entry.daysAgo * DAY),
    })),
  });

  console.log(`
Seeded the PulseOps demo workspace in ${((Date.now() - started) / 1000).toFixed(1)}s

  Organization   Northwind Demo  (/org/${DEMO_SLUG})
  Monitors       ${monitors.size}  → ${TARGETS_URL}
  Checks         ${checkCount.toLocaleString("en-US")} (last ${RAW_DAYS} days) + ${HISTORY_DAYS} days of daily rollups
  Incidents      ${incidentIds.length}
  Status page    /status/northwind

  Sign in        demo@northwind.example
  Password       ${DEMO_PASSWORD}

  Other roles    priya@ (admin), marcus@ (member), sofia@ (viewer) — same password.
  All of the above is sample data and is labelled as such in the UI.
`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
