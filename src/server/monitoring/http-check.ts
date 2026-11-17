import http from "node:http";
import https from "node:https";
import type { Socket } from "node:net";

import { MONITOR_LIMITS } from "@/shared/constants";
import { CheckErrorType, CheckStatus, type HttpMethod } from "@/shared/enums";
import { matchesExpectedStatus } from "@/shared/status-codes";

import { createPinnedLookup, defaultSsrfPolicy, SsrfBlockedError, type SsrfPolicy, validateTargetUrl } from "./ssrf";

/**
 * Executes one HTTP check.
 *
 * Built on Node's core `http`/`https` rather than `fetch` for two reasons: the
 * `lookup` hook lets the SSRF guard pin the connection to a vetted address,
 * and socket events expose DNS / connect / TLS / first-byte timings.
 *
 * Every attempt opens a fresh connection (no keep-alive), because a monitor
 * should measure what a new visitor experiences, including the handshake.
 */

export interface CheckTarget {
  url: string;
  method: HttpMethod;
  timeoutMs: number;
  expectedStatusCodes: string;
  followRedirects: boolean;
  retries: number;
  degradedThresholdMs: number | null;
}

export interface CheckTimings {
  dnsMs: number | null;
  connectMs: number | null;
  tlsMs: number | null;
  ttfbMs: number | null;
}

export interface CheckOutcome extends CheckTimings {
  status: CheckStatus;
  ok: boolean;
  statusCode: number | null;
  /** Wall-clock time to response headers for the final attempt, redirects included. */
  responseTimeMs: number | null;
  errorType: CheckErrorType | null;
  errorMessage: string | null;
  attempts: number;
  finalUrl: string | null;
  redirects: number;
}

export interface CheckOptions {
  policy?: SsrfPolicy;
  /** Pause between in-check retries. Shortened in tests. */
  retryDelayMs?: number;
  userAgent?: string;
}

const USER_AGENT = "PulseOps-Monitor/1.0 (+https://github.com/pulseops)";
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

const DNS_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_FAIL", "EAI_NODATA", "EAI_NONAME", "ENODATA"]);
const CONNECTION_CODES = new Set([
  "ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "EPIPE", "ECONNABORTED", "EADDRNOTAVAIL", "EHOSTDOWN",
  "ERR_SOCKET_CLOSED", "ERR_STREAM_PREMATURE_CLOSE", "HPE_INVALID_CONSTANT", "ETIMEDOUT",
]);

class CheckFailure extends Error {
  constructor(
    public readonly errorType: CheckErrorType,
    message: string,
  ) {
    super(message);
  }
}

/** Maps a low-level error to a category and a message that is safe to store and display. */
export function classifyError(error: unknown): { errorType: CheckErrorType; errorMessage: string } {
  if (error instanceof CheckFailure) return { errorType: error.errorType, errorMessage: error.message };
  if (error instanceof SsrfBlockedError) return { errorType: CheckErrorType.BLOCKED, errorMessage: error.message };

  const code = String((error as { code?: unknown } | null)?.code ?? "");
  const raw = error instanceof Error ? error.message : String(error);

  if (DNS_CODES.has(code)) {
    return { errorType: CheckErrorType.DNS, errorMessage: `DNS lookup failed (${code}).` };
  }
  if (
    code.startsWith("CERT_") || code.startsWith("ERR_TLS") || code.startsWith("ERR_SSL") || code.includes("SELF_SIGNED") ||
    code.startsWith("UNABLE_TO_") || code === "DEPTH_ZERO_SELF_SIGNED_CERT" || code === "EPROTO" || /certificate|TLS|SSL/i.test(raw)
  ) {
    const reason: Record<string, string> = {
      CERT_HAS_EXPIRED: "the certificate has expired",
      CERT_NOT_YET_VALID: "the certificate is not valid yet",
      DEPTH_ZERO_SELF_SIGNED_CERT: "the certificate is self-signed",
      SELF_SIGNED_CERT_IN_CHAIN: "the chain contains a self-signed certificate",
      UNABLE_TO_VERIFY_LEAF_SIGNATURE: "the certificate chain is incomplete",
      UNABLE_TO_GET_ISSUER_CERT_LOCALLY: "the certificate issuer is not trusted",
      ERR_TLS_CERT_ALTNAME_INVALID: "the certificate does not match the hostname",
    };
    return { errorType: CheckErrorType.TLS, errorMessage: `TLS error: ${reason[code] ?? `handshake failed (${code || "unknown"})`}.` };
  }
  if (CONNECTION_CODES.has(code)) {
    const reason: Record<string, string> = {
      ECONNREFUSED: "connection refused",
      ECONNRESET: "connection reset by peer",
      EHOSTUNREACH: "host unreachable",
      ENETUNREACH: "network unreachable",
      ETIMEDOUT: "connection timed out",
    };
    return { errorType: CheckErrorType.CONNECTION, errorMessage: `Connection failed: ${reason[code] ?? code}.` };
  }
  // Unknown errors may embed URLs or addresses; store the code, not the text.
  return { errorType: CheckErrorType.UNKNOWN, errorMessage: `Request failed${code ? ` (${code})` : ""}.` };
}

interface HopResult extends CheckTimings {
  statusCode: number;
  location: string | null;
}

function requestOnce(url: URL, method: HttpMethod, deadline: number, policy: SsrfPolicy, userAgent: string): Promise<HopResult> {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = validateTargetUrl(url, policy);
    } catch (error) {
      reject(error);
      return;
    }

    const remaining = deadline - performance.now();
    if (remaining <= 0) {
      reject(new CheckFailure(CheckErrorType.TIMEOUT, "Timed out before the request could start."));
      return;
    }

    const started = performance.now();
    const marks: { dns?: number; connect?: number; tls?: number } = {};
    const secure = url.protocol === "https:";
    let settled = false;

    const request = (secure ? https : http).request(
      {
        protocol: url.protocol,
        hostname: target.hostname.replace(/^\[|\]$/g, ""),
        port: target.port,
        path: `${url.pathname}${url.search}`,
        method,
        agent: false,
        lookup: createPinnedLookup(target),
        servername: secure ? target.hostname.replace(/^\[|\]$/g, "") : undefined,
        headers: {
          "User-Agent": userAgent,
          Accept: "*/*",
          "Accept-Encoding": "identity",
          Connection: "close",
          ...(method === "POST" ? { "Content-Length": "0" } : {}),
        },
      },
      (response) => {
        const ttfb = performance.now();
        settled = true;
        clearTimeout(timer);
        const connectEnd = marks.connect ?? started;
        resolve({
          statusCode: response.statusCode ?? 0,
          location: typeof response.headers.location === "string" ? response.headers.location : null,
          dnsMs: marks.dns === undefined ? null : Math.round(marks.dns - started),
          connectMs: marks.connect === undefined ? null : Math.round(marks.connect - (marks.dns ?? started)),
          tlsMs: marks.tls === undefined ? null : Math.round(marks.tls - connectEnd),
          ttfbMs: Math.round(ttfb - (marks.tls ?? connectEnd)),
        });
        // Headers are all a check needs. Dropping the body bounds memory and time.
        response.destroy();
        request.destroy();
      },
    );

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      request.destroy();
      reject(new CheckFailure(CheckErrorType.TIMEOUT, "No response within the configured timeout."));
    }, remaining);

    request.on("socket", (socket: Socket) => {
      socket.once("lookup", () => (marks.dns = performance.now()));
      socket.once("connect", () => (marks.connect = performance.now()));
      socket.once("secureConnect", () => (marks.tls = performance.now()));
    });
    request.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    request.end();
  });
}

async function attempt(target: CheckTarget, policy: SsrfPolicy, userAgent: string) {
  const started = performance.now();
  const deadline = started + target.timeoutMs;
  let url = new URL(target.url);
  let method = target.method;
  let redirects = 0;
  let first: HopResult | null = null;

  for (;;) {
    const hop = await requestOnce(url, method, deadline, policy, userAgent);
    first ??= hop;

    if (target.followRedirects && REDIRECT_CODES.has(hop.statusCode) && hop.location) {
      if (redirects >= MONITOR_LIMITS.maxRedirects) {
        throw new CheckFailure(CheckErrorType.REDIRECT, `Stopped after ${MONITOR_LIMITS.maxRedirects} redirects.`);
      }
      let next: URL;
      try {
        next = new URL(hop.location, url);
      } catch {
        throw new CheckFailure(CheckErrorType.REDIRECT, "The server sent a redirect to an invalid location.");
      }
      if (url.protocol === "https:" && next.protocol === "http:") {
        throw new CheckFailure(CheckErrorType.REDIRECT, "Refused a redirect from HTTPS down to HTTP.");
      }
      // 303 always becomes GET; 301/302 do for POST, as browsers behave.
      if (hop.statusCode === 303 || ((hop.statusCode === 301 || hop.statusCode === 302) && method === "POST")) method = "GET";
      url = next;
      redirects += 1;
      continue;
    }

    return {
      statusCode: hop.statusCode,
      responseTimeMs: Math.round(performance.now() - started),
      // Phase timings describe the first connection; later hops are folded into the total.
      timings: { dnsMs: first.dnsMs, connectMs: first.connectMs, tlsMs: first.tlsMs, ttfbMs: first.ttfbMs },
      // Path only: query strings can carry secrets and are never stored or echoed.
      finalUrl: `${url.origin}${url.pathname}`,
      redirects,
    };
  }
}

const NO_TIMINGS: CheckTimings = { dnsMs: null, connectMs: null, tlsMs: null, ttfbMs: null };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs a check with its in-check retries. Never throws: every failure mode is
 * a recorded outcome. Policy violations are not retried, since retrying
 * cannot change the answer.
 */
export async function performCheck(target: CheckTarget, options: CheckOptions = {}): Promise<CheckOutcome> {
  const policy = options.policy ?? defaultSsrfPolicy();
  const userAgent = options.userAgent ?? USER_AGENT;
  const maxAttempts = Math.max(1, target.retries + 1);
  let last: CheckOutcome | null = null;

  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
    try {
      const result = await attempt(target, policy, userAgent);
      if (!matchesExpectedStatus(target.expectedStatusCodes, result.statusCode)) {
        last = {
          ...result.timings,
          status: CheckStatus.DOWN,
          ok: false,
          statusCode: result.statusCode,
          responseTimeMs: result.responseTimeMs,
          errorType: CheckErrorType.HTTP_STATUS,
          errorMessage: `Received HTTP ${result.statusCode}; expected ${target.expectedStatusCodes}.`,
          attempts: attemptNumber,
          finalUrl: result.finalUrl,
          redirects: result.redirects,
        };
      } else {
        const slow = target.degradedThresholdMs !== null && result.responseTimeMs > target.degradedThresholdMs;
        return {
          ...result.timings,
          status: slow ? CheckStatus.DEGRADED : CheckStatus.UP,
          ok: true,
          statusCode: result.statusCode,
          responseTimeMs: result.responseTimeMs,
          errorType: null,
          errorMessage: null,
          attempts: attemptNumber,
          finalUrl: result.finalUrl,
          redirects: result.redirects,
        };
      }
    } catch (error) {
      const classified = classifyError(error);
      last = {
        ...NO_TIMINGS,
        status: CheckStatus.DOWN,
        ok: false,
        statusCode: null,
        responseTimeMs: null,
        ...classified,
        attempts: attemptNumber,
        finalUrl: null,
        redirects: 0,
      };
      if (classified.errorType === CheckErrorType.BLOCKED) return last;
    }
    if (attemptNumber < maxAttempts) await sleep(options.retryDelayMs ?? 400 * attemptNumber);
  }

  // The loop always assigns `last` before falling through.
  return last as CheckOutcome;
}
