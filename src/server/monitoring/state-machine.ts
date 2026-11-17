import { CheckStatus, MonitorStatus } from "@/shared/enums";

/**
 * The outage state machine. Pure: given the monitor's counters and one check
 * result it returns the next state and what, if anything, just happened.
 *
 *            success                      failures < threshold
 *   PENDING ─────────▶ UP ◀──────────────▶ DEGRADED
 *                       ▲   slow / fast      │ failures ≥ threshold
 *                       │                    ▼
 *                       └──────────────── DOWN
 *                     successes ≥ recoveryThreshold
 *
 * Two thresholds give hysteresis in both directions. One failed check never
 * pages anyone, and one lucky success in the middle of an outage never
 * declares recovery, so a flapping endpoint cannot generate an incident storm.
 */

export interface MonitorState {
  status: MonitorStatus;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
}

export interface MonitorPolicy {
  failureThreshold: number;
  recoveryThreshold: number;
}

export type Transition =
  /** Crossed the failure threshold: the monitor is now confirmed down. */
  | "went_down"
  /** Met the recovery threshold after being down. */
  | "recovered"
  /** Entered DEGRADED from a healthy state (slow, or failing below threshold). */
  | "degraded"
  /** Left DEGRADED for UP without ever having been down. */
  | "improved"
  | null;

export interface TransitionResult extends MonitorState {
  transition: Transition;
  statusChanged: boolean;
}

export function nextMonitorState(current: MonitorState, check: CheckStatus, policy: MonitorPolicy): TransitionResult {
  const failureThreshold = Math.max(1, policy.failureThreshold);
  const recoveryThreshold = Math.max(1, policy.recoveryThreshold);
  const wasDown = current.status === MonitorStatus.DOWN;
  const failed = check === CheckStatus.DOWN;

  let status: MonitorStatus;
  let consecutiveFailures: number;
  let consecutiveSuccesses: number;
  let transition: Transition = null;

  if (failed) {
    consecutiveFailures = current.consecutiveFailures + 1;
    consecutiveSuccesses = 0;
    if (wasDown) {
      status = MonitorStatus.DOWN;
    } else if (consecutiveFailures >= failureThreshold) {
      status = MonitorStatus.DOWN;
      transition = "went_down";
    } else {
      status = MonitorStatus.DEGRADED;
      if (current.status !== MonitorStatus.DEGRADED) transition = "degraded";
    }
  } else {
    consecutiveFailures = 0;
    consecutiveSuccesses = current.consecutiveSuccesses + 1;
    const healthy = check === CheckStatus.DEGRADED ? MonitorStatus.DEGRADED : MonitorStatus.UP;
    if (wasDown) {
      if (consecutiveSuccesses >= recoveryThreshold) {
        status = healthy;
        transition = "recovered";
      } else {
        // Still counted as down until recovery is sustained.
        status = MonitorStatus.DOWN;
      }
    } else {
      status = healthy;
      if (status === MonitorStatus.DEGRADED && current.status !== MonitorStatus.DEGRADED) transition = "degraded";
      if (status === MonitorStatus.UP && current.status === MonitorStatus.DEGRADED) transition = "improved";
    }
  }

  return { status, consecutiveFailures, consecutiveSuccesses, transition, statusChanged: status !== current.status };
}
