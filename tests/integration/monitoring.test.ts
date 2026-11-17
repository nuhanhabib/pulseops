import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { type CheckOutcome, type CheckTarget, performCheck } from "@/server/monitoring/http-check";
import { applyCheckResult } from "@/server/monitoring/process-result";
import { STRICT_SSRF_POLICY } from "@/server/monitoring/ssrf";
import { rollupDailyAggregates } from "@/server/modules/metrics/queries";
import { getMonitorStats } from "@/server/modules/monitors/service";
import { getPublicStatusPage } from "@/server/modules/status-pages/service";
import { claimDueMonitors } from "@/worker/scheduler";

import { contextFor, createMonitor, createTenant } from "../helpers/factories";

// ── A local target the checker can talk to ──────────────────────────────────

let server: http.Server;
let port: number;
let hits = 0;

beforeAll(async () => {
  server = http.createServer((request, response) => {
    hits += 1;
    const path = request.url ?? "/";
    if (path === "/ok") return void response.writeHead(200).end("ok");
    if (path === "/slow") return void setTimeout(() => response.writeHead(200).end("ok"), 250);
    if (path === "/500") return void response.writeHead(500).end();
    if (path === "/hang") return; // never answers
    if (path === "/redirect") return void response.writeHead(302, { Location: "/ok" }).end();
    if (path === "/loop") return void response.writeHead(302, { Location: "/loop" }).end();
    // A public-looking endpoint that redirects to the cloud metadata address.
    if (path === "/to-metadata") return void response.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data/" }).end();
    if (path === "/flaky") return void response.writeHead(hits % 2 === 0 ? 200 : 503).end();
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

/** Loopback is exempted for exactly this test server; everything else stays blocked. */
const policy = () => ({ allowedPrivateHosts: [{ host: "127.0.0.1", port }] });
const target = (path: string, overrides: Partial<CheckTarget> = {}): CheckTarget => ({
  url: `http://127.0.0.1:${port}${path}`, method: "GET", timeoutMs: 1500, expectedStatusCodes: "200-299", followRedirects: true, retries: 0, degradedThresholdMs: null, ...overrides,
});
const check = (path: string, overrides: Partial<CheckTarget> = {}) => performCheck(target(path, overrides), { policy: policy(), retryDelayMs: 5 });

describe("HTTP checker", () => {
  it("records a successful check with timings", async () => {
    const outcome = await check("/ok");
    expect(outcome).toMatchObject({ status: "UP", ok: true, statusCode: 200, errorType: null, attempts: 1 });
    expect(outcome.responseTimeMs).toBeGreaterThanOrEqual(0);
    expect(outcome.ttfbMs).not.toBeNull();
  });

  it("marks a slow success as degraded", async () => {
    expect(await check("/slow", { degradedThresholdMs: 100 })).toMatchObject({ status: "DEGRADED", ok: true });
  });

  it("fails on an unexpected status code, and passes when that code is expected", async () => {
    expect(await check("/500")).toMatchObject({ status: "DOWN", statusCode: 500, errorType: "HTTP_STATUS" });
    expect(await check("/500", { expectedStatusCodes: "500" })).toMatchObject({ status: "UP" });
  });

  it("times out instead of hanging", async () => {
    const started = Date.now();
    const outcome = await check("/hang", { timeoutMs: 300 });
    expect(outcome).toMatchObject({ status: "DOWN", errorType: "TIMEOUT" });
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it("classifies connection and DNS failures", async () => {
    const refused = await performCheck({ ...target("/ok"), url: "http://127.0.0.1:1/" }, { policy: { allowedPrivateHosts: [{ host: "127.0.0.1", port: 1 }] } });
    expect(refused).toMatchObject({ status: "DOWN", errorType: "CONNECTION" });
    const dns = await performCheck({ ...target("/ok"), url: "http://does-not-exist.invalid/" }, { policy: STRICT_SSRF_POLICY });
    expect(dns).toMatchObject({ status: "DOWN", errorType: "DNS" });
  });

  it("follows redirects, stops loops, and can be told not to follow", async () => {
    expect(await check("/redirect")).toMatchObject({ status: "UP", redirects: 1 });
    expect(await check("/loop")).toMatchObject({ status: "DOWN", errorType: "REDIRECT" });
    expect(await check("/redirect", { followRedirects: false })).toMatchObject({ status: "DOWN", statusCode: 302 });
  });

  it("re-validates redirect targets and refuses one that points at a private address", async () => {
    const outcome = await check("/to-metadata");
    expect(outcome).toMatchObject({ status: "DOWN", errorType: "BLOCKED" });
  });

  it("refuses private targets outright under the default policy, without connecting", async () => {
    const before = hits;
    const outcome = await performCheck(target("/ok"), { policy: STRICT_SSRF_POLICY });
    expect(outcome).toMatchObject({ status: "DOWN", errorType: "BLOCKED", attempts: 1 });
    expect(hits).toBe(before);
  });

  it("retries inside one check before recording a failure", async () => {
    hits = 0; // first request → 503, retry → 200
    const outcome = await check("/flaky", { retries: 2 });
    expect(outcome).toMatchObject({ status: "UP", attempts: 2 });
  });

  it("never stores query strings in the final URL", async () => {
    const outcome = await check("/ok?token=secret");
    expect(outcome.finalUrl).not.toContain("secret");
  });
});

// ── The result pipeline ─────────────────────────────────────────────────────

const failure = (message = "Received HTTP 503; expected 200-299."): CheckOutcome => ({
  status: "DOWN", ok: false, statusCode: 503, responseTimeMs: 40, errorType: "HTTP_STATUS", errorMessage: message, attempts: 2,
  finalUrl: null, redirects: 0, dnsMs: null, connectMs: null, tlsMs: null, ttfbMs: null,
});
const success = (ms = 120): CheckOutcome => ({
  status: "UP", ok: true, statusCode: 200, responseTimeMs: ms, errorType: null, errorMessage: null, attempts: 1,
  finalUrl: null, redirects: 0, dnsMs: 3, connectMs: 5, tlsMs: null, ttfbMs: ms - 8,
});

async function feed(monitorId: string, organizationId: string, outcomes: CheckOutcome[], start = Date.now() - outcomes.length * 60_000) {
  const results = [];
  for (const [index, outcome] of outcomes.entries()) {
    results.push(await applyCheckResult(monitorId, organizationId, outcome, new Date(start + index * 60_000)));
  }
  return results;
}

describe("outage detection and recovery", () => {
  it("opens exactly one incident after sustained failures, however long the outage lasts", async () => {
    const { org } = await createTenant();
    const monitor = await createMonitor(org.id, { name: "Checkout API", failureThreshold: 3 });

    const early = await feed(monitor.id, org.id, [failure(), failure()]);
    expect(early.map((result) => result.status)).toEqual(["DEGRADED", "DEGRADED"]);
    expect(await prisma.incident.count()).toBe(0);

    // Threshold reached, then the outage continues for many more checks.
    await feed(monitor.id, org.id, Array.from({ length: 12 }, () => failure()));
    const incidents = await prisma.incident.findMany({ include: { monitors: true, updates: true } });
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ source: "AUTOMATED", status: "INVESTIGATING", severity: "HIGH", number: 1, title: "Checkout API is down" });
    expect(incidents[0]?.monitors.map((link) => link.monitorId)).toEqual([monitor.id]);

    expect(await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id } })).toMatchObject({ status: "DOWN", consecutiveFailures: 14 });
    expect(await prisma.monitorCheck.count({ where: { monitorId: monitor.id } })).toBe(14);
    // One "down" event and one set of notifications, not fourteen.
    expect(await prisma.activityEvent.count({ where: { type: "MONITOR_DOWN" } })).toBe(1);
    expect(await prisma.notificationDelivery.count({ where: { event: "MONITOR_DOWN" } })).toBe(1);
    expect(await prisma.notificationDelivery.count({ where: { event: "INCIDENT_CREATED" } })).toBe(1);
  });

  it("requires sustained recovery, then resolves the automated incident", async () => {
    const { org } = await createTenant();
    const monitor = await createMonitor(org.id, { failureThreshold: 2, recoveryThreshold: 2 });
    await feed(monitor.id, org.id, [failure(), failure()]);

    // One success in the middle of an outage is not recovery.
    const [flap] = await feed(monitor.id, org.id, [success()]);
    expect(flap).toMatchObject({ status: "DOWN", transition: null });
    await feed(monitor.id, org.id, [failure()]);
    expect((await prisma.incident.findFirstOrThrow()).status).toBe("INVESTIGATING");

    const recovery = await feed(monitor.id, org.id, [success(), success()]);
    expect(recovery[1]).toMatchObject({ status: "UP", transition: "recovered" });
    const incident = await prisma.incident.findFirstOrThrow({ include: { updates: { orderBy: { createdAt: "asc" } } } });
    expect(incident.status).toBe("RESOLVED");
    expect(incident.resolvedAt).not.toBeNull();
    expect(incident.updates.at(-1)).toMatchObject({ kind: "SYSTEM", status: "RESOLVED", isPublic: false });
    expect(await prisma.incident.count()).toBe(1);

    // A later outage is a new incident with the next number.
    await feed(monitor.id, org.id, [failure(), failure()]);
    const all = await prisma.incident.findMany({ orderBy: { number: "asc" } });
    expect(all.map((item) => [item.number, item.status])).toEqual([[1, "RESOLVED"], [2, "INVESTIGATING"]]);
  });

  it("attaches to an existing open incident instead of opening a duplicate, and leaves manual incidents open on recovery", async () => {
    const { org, user } = await createTenant();
    const monitor = await createMonitor(org.id, { failureThreshold: 1, recoveryThreshold: 1 });
    const manual = await prisma.incident.create({
      data: { organizationId: org.id, number: 1, title: "Investigating slow checkout", source: "MANUAL", createdById: user.id, monitors: { create: { monitorId: monitor.id, organizationId: org.id } } },
    });
    await prisma.organization.update({ where: { id: org.id }, data: { incidentCounter: 1 } });

    await feed(monitor.id, org.id, [failure()]);
    expect(await prisma.incident.count()).toBe(1);
    await feed(monitor.id, org.id, [success()]);
    const after = await prisma.incident.findUniqueOrThrow({ where: { id: manual.id }, include: { updates: true } });
    // People decide when a human-declared incident is over.
    expect(after.status).toBe("INVESTIGATING");
    expect(after.updates.some((update) => update.message.includes("recovered"))).toBe(true);
  });

  it("respects the organization's auto-resolve setting and the monitor's auto-incident setting", async () => {
    const { org } = await createTenant();
    await prisma.organization.update({ where: { id: org.id }, data: { autoResolveIncidents: false } });
    const monitor = await createMonitor(org.id, { failureThreshold: 1, recoveryThreshold: 1 });
    await feed(monitor.id, org.id, [failure(), success()]);
    expect((await prisma.incident.findFirstOrThrow()).status).toBe("INVESTIGATING");

    const quiet = await createMonitor(org.id, { failureThreshold: 1, autoIncident: false });
    await feed(quiet.id, org.id, [failure()]);
    expect(await prisma.incident.count()).toBe(1);
    expect((await prisma.monitor.findUniqueOrThrow({ where: { id: quiet.id } })).status).toBe("DOWN");
  });

  it("never opens duplicates when results for one monitor are processed concurrently", async () => {
    const { org } = await createTenant();
    const monitor = await createMonitor(org.id, { failureThreshold: 1 });
    await Promise.all(Array.from({ length: 8 }, (_, index) => applyCheckResult(monitor.id, org.id, failure(), new Date(Date.now() + index))));
    expect(await prisma.incident.count()).toBe(1);
    expect((await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id } })).consecutiveFailures).toBe(8);
  });

  it("ignores results for paused monitors and for monitors in another organization", async () => {
    const acme = await createTenant("Acme");
    const globex = await createTenant("Globex");
    const paused = await createMonitor(acme.org.id, { enabled: false, status: "PAUSED" });
    expect(await applyCheckResult(paused.id, acme.org.id, failure())).toEqual({ applied: false });

    const monitor = await createMonitor(acme.org.id);
    // A job payload naming the wrong tenant must not touch the monitor.
    expect(await applyCheckResult(monitor.id, globex.org.id, failure())).toEqual({ applied: false });
    expect(await prisma.monitorCheck.count()).toBe(0);
  });

  it("does not notify the same recipient twice for one occurrence", async () => {
    const { org } = await createTenant();
    await prisma.notificationChannel.create({ data: { organizationId: org.id, type: "EMAIL", name: "On-call", config: { recipients: ["oncall@test.example"] }, events: ["MONITOR_DOWN"] } });
    const monitor = await createMonitor(org.id, { failureThreshold: 1 });
    await feed(monitor.id, org.id, [failure()]);
    const deliveries = await prisma.notificationDelivery.findMany({ where: { event: "MONITOR_DOWN" } });
    // The owner (personal preference) and the channel recipient: two distinct destinations.
    expect(deliveries.map((delivery) => delivery.recipient).sort()).toHaveLength(2);
    expect(new Set(deliveries.map((delivery) => delivery.dedupeKey)).size).toBe(2);
    expect(deliveries.every((delivery) => delivery.status === "PENDING")).toBe(true);
  });
});

describe("uptime from stored checks", () => {
  it("reports the measured share of successful checks", async () => {
    const { org, user } = await createTenant();
    const monitor = await createMonitor(org.id, { failureThreshold: 99, intervalSeconds: 60 });
    const outcomes = [...Array.from({ length: 18 }, () => success(100)), failure(), failure()];
    await feed(monitor.id, org.id, outcomes, Date.now() - 40 * 60_000);

    const stats = await getMonitorStats(await contextFor(user.id, org.slug), monitor.id, "24h");
    expect(stats.totalChecks).toBe(20);
    expect(stats.failedChecks).toBe(2);
    expect(stats.uptime).toBeCloseTo(90);
    expect(stats.avgResponseMs).toBe(100);
    expect(stats.estimatedDowntimeSeconds).toBe(120);
    expect(stats.outages).toHaveLength(1);
    expect(stats.outages[0]).toMatchObject({ failedChecks: 2, endedAt: null });
    expect(stats.origin).toEqual({ live: 20, seed: 0 });

    // The daily rollup agrees with the raw figures.
    await rollupDailyAggregates(new Date(Date.now() - 2 * 86_400_000));
    const days = await prisma.monitorDailyAggregate.findMany({ where: { monitorId: monitor.id } });
    expect(days.reduce((sum, day) => sum + day.totalChecks, 0)).toBe(20);
    expect(days.reduce((sum, day) => sum + day.downChecks, 0)).toBe(2);
  });
});

describe("scheduler", () => {
  it("claims each due monitor once and reschedules it", async () => {
    const { org } = await createTenant();
    const past = new Date(Date.now() - 5000);
    const due = await createMonitor(org.id, { nextCheckAt: past, intervalSeconds: 60 });
    await createMonitor(org.id, { nextCheckAt: new Date(Date.now() + 60_000) });
    await createMonitor(org.id, { nextCheckAt: past, enabled: false, status: "PAUSED" });

    // Two workers ticking at the same instant must not both claim the monitor.
    const [first, second] = await Promise.all([claimDueMonitors(), claimDueMonitors()]);
    const claimed = [...first, ...second];
    expect(claimed.map((monitor) => monitor.id)).toEqual([due.id]);
    expect(claimed[0]?.organizationId).toBe(org.id);

    const after = await prisma.monitor.findUniqueOrThrow({ where: { id: due.id } });
    expect(after.nextCheckAt.getTime()).toBeGreaterThan(Date.now() + 50_000);
    expect(await claimDueMonitors()).toEqual([]);
  });
});

describe("public status page", () => {
  it("publishes only what was explicitly made public", async () => {
    const { org, user } = await createTenant("Initech");
    const monitor = await createMonitor(org.id, { name: "internal-billing-db-proxy", url: "https://billing.corp.initech.example/private-health?key=abc" });
    const hidden = await createMonitor(org.id, { name: "secret-admin-panel" });
    await prisma.statusPage.create({
      data: { organizationId: org.id, slug: "initech", name: "Initech Status", published: true, monitors: { create: { monitorId: monitor.id, displayName: "Billing" } } },
    });
    await prisma.statusPage.create({ data: { organizationId: org.id, slug: "initech-draft", name: "Draft", published: false } });
    await prisma.incident.create({
      data: {
        organizationId: org.id, number: 1, title: "Billing delays", isPublic: true, assigneeId: user.id,
        monitors: { create: [{ monitorId: monitor.id, organizationId: org.id }, { monitorId: hidden.id, organizationId: org.id }] },
        updates: { create: [
          { organizationId: org.id, kind: "UPDATE", isPublic: true, message: "We are investigating delayed invoices." },
          { organizationId: org.id, kind: "UPDATE", isPublic: false, message: "INTERNAL-UPDATE: suspect the vendor" },
          { organizationId: org.id, kind: "SYSTEM", isPublic: false, message: "SYSTEM-EVENT: internal-billing-db-proxy failed" },
        ] },
        notes: { create: { organizationId: org.id, body: "INTERNAL-NOTE: customer X is furious", authorId: user.id } },
      },
    });
    await prisma.incident.create({
      data: { organizationId: org.id, number: 2, title: "PRIVATE-INCIDENT not for customers", isPublic: false, monitors: { create: { monitorId: monitor.id, organizationId: org.id } } },
    });

    const page = await getPublicStatusPage("initech");
    expect(page).not.toBeNull();
    expect(page?.components.map((component) => component.name)).toEqual(["Billing"]);
    expect(page?.activeIncidents).toHaveLength(1);
    expect(page?.activeIncidents[0]?.updates.map((update) => update.message)).toEqual(["We are investigating delayed invoices."]);
    expect(page?.activeIncidents[0]?.components).toEqual(["Billing"]);

    const serialized = JSON.stringify(page);
    for (const secret of ["internal-billing-db-proxy", "secret-admin-panel", "corp.initech", "key=abc", "INTERNAL-UPDATE", "SYSTEM-EVENT", "INTERNAL-NOTE", "PRIVATE-INCIDENT", user.email, user.name, monitor.id, org.id]) {
      expect(serialized, secret).not.toContain(secret);
    }

    // Drafts and unknown slugs are indistinguishable.
    expect(await getPublicStatusPage("initech-draft")).toBeNull();
    expect(await getPublicStatusPage("does-not-exist")).toBeNull();
  });
});
