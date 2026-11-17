import { describe, expect, it } from "vitest";

import { sanitizeMetadata } from "@/server/audit";
import { limiterUnavailable, rateLimited } from "@/server/errors";
import { sanitizeForModel } from "@/server/modules/ai/context";
import { formatDuration, formatMs, formatRelative } from "@/shared/format";
import { assignableRoles, can, canManageRole } from "@/shared/permissions";
import { safeRedirectPath } from "@/shared/routes";
import { passwordSchema, registerSchema } from "@/shared/schemas/auth";
import { createMonitorSchema } from "@/shared/schemas/monitor";
import { slugify, slugSchema } from "@/shared/schemas/organization";
import { matchesExpectedStatus, normalizeStatusExpression, parseStatusExpression } from "@/shared/status-codes";
import { combineCounts, estimatedDowntimeSeconds, formatUptime, percentile, uptimePercent } from "@/shared/uptime";

describe("uptime calculation", () => {
  it("is the share of checks that were not down", () => {
    expect(uptimePercent({ total: 1000, down: 1 })).toBeCloseTo(99.9);
    expect(uptimePercent({ total: 4, down: 4 })).toBe(0);
    expect(uptimePercent({ total: 10, down: 0 })).toBe(100);
  });
  it("is null, not 100, when there are no checks", () => {
    expect(uptimePercent({ total: 0, down: 0 })).toBeNull();
  });
  it("combines windows by summing counts, not by averaging percentages", () => {
    // 1 of 10 failed, then 0 of 990: the honest figure is 99.9%, not the 95% an average of 90 and 100 gives.
    const combined = combineCounts([{ total: 10, down: 1 }, { total: 990, down: 0 }]);
    expect(uptimePercent(combined)).toBeCloseTo(99.9);
  });
  it("never rounds an imperfect figure up to 100%", () => {
    expect(formatUptime(99.999)).toBe("99.99%");
    expect(formatUptime(100)).toBe("100%");
    expect(formatUptime(null)).toBe("—");
  });
  it("estimates downtime as failed checks × interval", () => {
    expect(estimatedDowntimeSeconds(5, 60)).toBe(300);
  });
  it("computes nearest-rank percentiles", () => {
    const values = Array.from({ length: 100 }, (_, index) => index + 1);
    expect(percentile(values, 0.95)).toBe(95);
    expect(percentile(values, 0.5)).toBe(50);
    expect(percentile([], 0.95)).toBeNull();
  });
});

describe("expected status expressions", () => {
  it("matches codes and ranges", () => {
    expect(matchesExpectedStatus("200-299,301", 204)).toBe(true);
    expect(matchesExpectedStatus("200-299,301", 301)).toBe(true);
    expect(matchesExpectedStatus("200-299,301", 302)).toBe(false);
  });
  it("rejects malformed input", () => {
    for (const bad of ["", "abc", "200-", "299-200", "99", "600", "200;300"]) expect(parseStatusExpression(bad).ok, bad).toBe(false);
  });
  it("normalizes to a canonical form", () => {
    expect(normalizeStatusExpression(" 301, 200-299 ,301")).toBe("200-299,301");
  });
});

describe("monitor validation", () => {
  const base = { name: "API", url: "https://example.com/health" };
  it("applies defaults", () => {
    expect(createMonitorSchema.parse(base)).toMatchObject({ method: "GET", intervalSeconds: 60, failureThreshold: 3 });
  });
  it.each(["example.com", "ftp://example.com", "https://user:pw@example.com", "javascript:alert(1)"])("rejects URL %s", (url) => {
    expect(createMonitorSchema.safeParse({ ...base, url }).success).toBe(false);
  });
  it("rejects a timeout that cannot fit inside the interval", () => {
    const result = createMonitorSchema.safeParse({ ...base, intervalSeconds: 30, timeoutMs: 20_000, retries: 1 });
    expect(result.success).toBe(false);
  });
  it("rejects a degraded threshold above the timeout", () => {
    expect(createMonitorSchema.safeParse({ ...base, timeoutMs: 2000, degradedThresholdMs: 5000 }).success).toBe(false);
  });
});

describe("password policy", () => {
  it("requires length and variety, and blocks common passwords", () => {
    expect(passwordSchema.safeParse("short1!").success).toBe(false);
    expect(passwordSchema.safeParse("onlyletterslong").success).toBe(false);
    expect(passwordSchema.safeParse("password123").success).toBe(false);
    expect(passwordSchema.safeParse("correct-horse-battery-9").success).toBe(true);
  });
  it("normalizes email and rejects password equal to it", () => {
    const parsed = registerSchema.safeParse({ name: "Ada", email: " Ada@Example.COM ", password: "ada@example.com", organizationName: "Acme" });
    expect(parsed.success).toBe(false);
  });
});

describe("permissions", () => {
  it("grants by role", () => {
    expect(can("VIEWER", "monitor:read")).toBe(true);
    expect(can("VIEWER", "monitor:write")).toBe(false);
    expect(can("MEMBER", "monitor:write")).toBe(true);
    expect(can("MEMBER", "monitor:delete")).toBe(false);
    expect(can("ADMIN", "audit:read")).toBe(true);
    expect(can("ADMIN", "org:delete")).toBe(false);
    expect(can("OWNER", "org:delete")).toBe(true);
  });
  it("lets admins manage only roles below their own", () => {
    expect(canManageRole("ADMIN", "MEMBER")).toBe(true);
    expect(canManageRole("ADMIN", "ADMIN")).toBe(false);
    expect(canManageRole("ADMIN", "OWNER")).toBe(false);
    expect(canManageRole("MEMBER", "VIEWER")).toBe(false);
    expect(assignableRoles("OWNER")).toContain("OWNER");
  });
});

describe("redirect validation", () => {
  it("allows same-site paths", () => expect(safeRedirectPath("/org/acme/monitors?x=1")).toBe("/org/acme/monitors?x=1"));
  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "", null])("falls back for %s", (target) => {
    expect(safeRedirectPath(target, "/org")).toBe("/org");
  });
});

describe("slugs", () => {
  it("derives a slug from a name", () => expect(slugify("Northwind Traders, Inc.")).toBe("northwind-traders-inc"));
  it("rejects reserved and malformed slugs", () => {
    expect(slugSchema.safeParse("api").success).toBe(false);
    expect(slugSchema.safeParse("Has Spaces").success).toBe(false);
    expect(slugSchema.safeParse("acme-status").success).toBe(true);
  });
});

describe("sanitization", () => {
  it("redacts credential-like keys from audit metadata", () => {
    expect(sanitizeMetadata({ name: "x", password: "hunter2", nested: { apiKey: "k", ok: 1 }, signingSecret: "s" })).toEqual({
      name: "x", password: "[redacted]", nested: { apiKey: "[redacted]", ok: 1 }, signingSecret: "[redacted]",
    });
  });
  it("strips URLs, addresses, emails and tokens before text reaches the AI provider", () => {
    const text = sanitizeForModel("GET https://internal.corp/api?key=abc from 10.2.3.4 by ops@corp.com token: fake-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345");
    expect(text).not.toMatch(/internal\.corp|10\.2\.3\.4|ops@corp\.com|fake-ABCDEF/);
    expect(text).toContain("[url]");
  });
});

describe("formatting", () => {
  it("formats durations and latencies", () => {
    expect(formatMs(184)).toBe("184 ms");
    expect(formatMs(2410)).toBe("2.41 s");
    expect(formatDuration(728)).toBe("12m 08s");
    expect(formatDuration(null)).toBe("—");
  });
  it("formats relative times against an explicit clock", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    expect(formatRelative("2026-01-01T11:56:00Z", now)).toBe("4m ago");
  });
});

describe("rate-limit errors", () => {
  it("tells the caller how long the limit lasts", () => {
    expect(rateLimited(40).message).toBe("Too many requests. Try again in 40 seconds.");
    expect(rateLimited(720, "Too many sign-in attempts. Try again in a few minutes.").message).toBe("Too many sign-in attempts. Try again in 12 minutes.");
    expect(rateLimited(40)).toMatchObject({ status: 429, retryAfterSeconds: 40 });
  });
  it("reports an unreachable limiter as an outage, not as the caller's fault", () => {
    const error = limiterUnavailable();
    expect(error.status).toBe(503);
    expect(error.code).toBe("service_unavailable");
    expect(error.message).toMatch(/Redis/);
  });
});
