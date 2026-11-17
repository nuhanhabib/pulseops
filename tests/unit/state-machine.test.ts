import { describe, expect, it } from "vitest";

import { type MonitorState, nextMonitorState } from "@/server/monitoring/state-machine";

const policy = { failureThreshold: 3, recoveryThreshold: 2 };
const up: MonitorState = { status: "UP", consecutiveFailures: 0, consecutiveSuccesses: 10 };

/** Feeds a sequence of check results through the machine and returns every step. */
function run(start: MonitorState, checks: ("UP" | "DEGRADED" | "DOWN")[], p = policy) {
  const steps = [];
  let state = start;
  for (const check of checks) {
    const next = nextMonitorState(state, check, p);
    steps.push(next);
    state = next;
  }
  return steps;
}

describe("monitor state machine", () => {
  it("does not declare an outage on a single failed check", () => {
    const [first] = run(up, ["DOWN"]);
    expect(first).toMatchObject({ status: "DEGRADED", consecutiveFailures: 1, transition: "degraded" });
  });

  it("goes down exactly when the failure threshold is reached, and only once", () => {
    const steps = run(up, ["DOWN", "DOWN", "DOWN", "DOWN", "DOWN"]);
    expect(steps.map((step) => step.status)).toEqual(["DEGRADED", "DEGRADED", "DOWN", "DOWN", "DOWN"]);
    expect(steps.map((step) => step.transition)).toEqual(["degraded", null, "went_down", null, null]);
  });

  it("resets the failure count when a success interrupts a failing streak", () => {
    const steps = run(up, ["DOWN", "DOWN", "UP", "DOWN", "DOWN"]);
    expect(steps.some((step) => step.status === "DOWN")).toBe(false);
    expect(steps.at(-1)?.consecutiveFailures).toBe(2);
  });

  it("stays down until recovery is sustained", () => {
    const down: MonitorState = { status: "DOWN", consecutiveFailures: 5, consecutiveSuccesses: 0 };
    const steps = run(down, ["UP", "UP"]);
    expect(steps[0]).toMatchObject({ status: "DOWN", transition: null, consecutiveSuccesses: 1 });
    expect(steps[1]).toMatchObject({ status: "UP", transition: "recovered" });
  });

  it("does not recover when a failure interrupts the recovery streak (flapping)", () => {
    const down: MonitorState = { status: "DOWN", consecutiveFailures: 5, consecutiveSuccesses: 0 };
    const steps = run(down, ["UP", "DOWN", "UP", "DOWN", "UP"]);
    expect(steps.every((step) => step.status === "DOWN")).toBe(true);
    expect(steps.every((step) => step.transition === null)).toBe(true);
  });

  it("recovers into DEGRADED when the recovering check is slow", () => {
    const down: MonitorState = { status: "DOWN", consecutiveFailures: 3, consecutiveSuccesses: 1 };
    expect(nextMonitorState(down, "DEGRADED", policy)).toMatchObject({ status: "DEGRADED", transition: "recovered" });
  });

  it("tracks slow responses as degraded and back", () => {
    const steps = run(up, ["DEGRADED", "DEGRADED", "UP"]);
    expect(steps.map((step) => step.transition)).toEqual(["degraded", null, "improved"]);
  });

  it("moves a pending monitor to UP on its first success without a transition event", () => {
    const pending: MonitorState = { status: "PENDING", consecutiveFailures: 0, consecutiveSuccesses: 0 };
    expect(nextMonitorState(pending, "UP", policy)).toMatchObject({ status: "UP", transition: null, statusChanged: true });
  });

  it("honours a threshold of one", () => {
    expect(nextMonitorState(up, "DOWN", { failureThreshold: 1, recoveryThreshold: 1 })).toMatchObject({ status: "DOWN", transition: "went_down" });
  });
});
