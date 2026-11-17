import { lookup as dnsLookup } from "node:dns";
import type { LookupFunction } from "node:net";

import ipaddr from "ipaddr.js";

import { type AllowedPrivateHost, getEnv, parseAllowedPrivateHosts } from "../env";

/**
 * Server-side request forgery (SSRF) guard for outbound checks and webhooks.
 *
 * Users tell PulseOps which URLs to fetch, so without a guard the worker
 * could be pointed at the cloud metadata service, the database, or anything
 * else on its private network. The guard has three layers:
 *
 *   1. URL policy      scheme, credentials, port, and hostname rules.
 *   2. Address policy  every resolved IP must be publicly routable.
 *   3. Pinned lookup   the socket connects to the exact address that passed
 *                      layer 2. There is no second DNS resolution between
 *                      "check" and "connect", which is the gap DNS-rebinding
 *                      attacks rely on.
 *
 * Redirects are followed manually by the caller, which re-runs all three
 * layers for every hop. Limits and residual risks: docs/security.md.
 */

export type SsrfBlockReason =
  | "invalid_url"
  | "scheme"
  | "credentials"
  | "port"
  | "hostname"
  | "private_address"
  | "dns_failure";

export class SsrfBlockedError extends Error {
  readonly code = "ESSRFBLOCKED";
  constructor(
    public readonly reason: SsrfBlockReason,
    message: string,
  ) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

export interface SsrfPolicy {
  /** Hosts exempt from the private-address block. Empty in any sane production setup. */
  allowedPrivateHosts: AllowedPrivateHost[];
}

export function defaultSsrfPolicy(): SsrfPolicy {
  return { allowedPrivateHosts: parseAllowedPrivateHosts(getEnv().MONITOR_ALLOWED_PRIVATE_HOSTS) };
}

export const STRICT_SSRF_POLICY: SsrfPolicy = { allowedPrivateHosts: [] };

/** Names that only ever resolve inside a private network. */
const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata", "metadata.google.internal", "instance-data", "kubernetes.default"]);
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home.arpa", ".svc", ".cluster.local"];

/**
 * ipaddr.js range names that are safe to connect to. Everything else
 * (loopback, private, linkLocal, uniqueLocal, carrierGradeNat, multicast,
 * reserved, unspecified, broadcast, 6to4, teredo, …) is refused. An allowlist
 * of ranges fails closed if the library ever learns a new special range.
 */
const PUBLIC_RANGES = new Set(["unicast"]);

function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/** Whether a literal IP address is publicly routable. Unparseable input is not. */
export function isPublicAddress(address: string): boolean {
  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    parsed = ipaddr.parse(stripBrackets(address));
  } catch {
    return false;
  }
  if (parsed.kind() === "ipv6") {
    const v6 = parsed as ipaddr.IPv6;
    // ::ffff:10.0.0.1 and friends are IPv4 in disguise: judge the embedded address.
    if (v6.isIPv4MappedAddress()) return PUBLIC_RANGES.has(v6.toIPv4Address().range());
    const range = v6.range();
    // NAT64 (64:ff9b::/96) embeds an IPv4 address that a gateway will route to.
    if (range === "rfc6052") {
      const bytes = v6.toByteArray().slice(12);
      return PUBLIC_RANGES.has(new ipaddr.IPv4(bytes).range());
    }
    return PUBLIC_RANGES.has(range);
  }
  return PUBLIC_RANGES.has(parsed.range());
}

function isAllowedPrivateHost(policy: SsrfPolicy, hostname: string, port: number): boolean {
  const host = stripBrackets(hostname).toLowerCase();
  return policy.allowedPrivateHosts.some((entry) => entry.host === host && (entry.port === null || entry.port === port));
}

export function effectivePort(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === "https:" ? 443 : 80;
}

export interface ValidatedTarget {
  url: URL;
  hostname: string;
  port: number;
  /** True when the host is on the operator's explicit private allowlist. */
  exempt: boolean;
}

/**
 * Layer 1. Synchronous and network-free, so it also runs when a monitor is
 * saved. The WHATWG URL parser has already canonicalized exotic IPv4 forms by
 * this point (`http://2130706433/`, `http://0x7f.1/` → 127.0.0.1), so the
 * address check below cannot be dodged with alternative encodings.
 */
export function validateTargetUrl(input: string | URL, policy: SsrfPolicy = defaultSsrfPolicy()): ValidatedTarget {
  let url: URL;
  try {
    url = typeof input === "string" ? new URL(input) : new URL(input.href);
  } catch {
    throw new SsrfBlockedError("invalid_url", "The URL is not valid.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfBlockedError("scheme", "Only http:// and https:// URLs can be requested.");
  }
  if (url.username || url.password) {
    throw new SsrfBlockedError("credentials", "URLs containing credentials are not allowed.");
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname) throw new SsrfBlockedError("hostname", "The URL has no hostname.");
  const port = effectivePort(url);
  const exempt = isAllowedPrivateHost(policy, hostname, port);

  if (!exempt) {
    // Low ports other than web ports are service ports (SSH, SMTP, …), never health endpoints.
    if (port < 1024 && port !== 80 && port !== 443) {
      throw new SsrfBlockedError("port", `Port ${port} is not allowed. Use 80, 443, or a port above 1023.`);
    }
    if (BLOCKED_HOSTNAMES.has(hostname) || BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
      throw new SsrfBlockedError("hostname", "That hostname points to a private network and cannot be monitored.");
    }
    const bare = stripBrackets(hostname);
    if (ipaddr.isValid(bare)) {
      if (!isPublicAddress(bare)) {
        throw new SsrfBlockedError("private_address", "Private, loopback, and link-local addresses cannot be monitored.");
      }
    } else if (!hostname.includes(".")) {
      // Single-label names resolve through the search domain, i.e. internally.
      throw new SsrfBlockedError("hostname", "Use a fully qualified hostname, such as status.example.com.");
    }
  }

  return { url, hostname, port, exempt };
}

type Resolver = typeof dnsLookup;

/**
 * Layers 2 and 3. Returns a `lookup` function for `http.request` that
 * resolves the name once, refuses the connection if *any* returned address is
 * non-public (so an attacker cannot mix one public and one private record and
 * hope for the right pick), and hands the socket only vetted addresses.
 */
export function createPinnedLookup(target: ValidatedTarget, resolver: Resolver = dnsLookup): LookupFunction {
  const pinned: LookupFunction = (hostname, options, callback) => {
    resolver(hostname, { all: true, family: 0, verbatim: true }, (error, addresses) => {
      if (error) {
        callback(error, "", 0);
        return;
      }
      const list = Array.isArray(addresses) ? addresses : [];
      if (list.length === 0) {
        callback(Object.assign(new Error(`No addresses found for ${hostname}`), { code: "ENOTFOUND" }), "", 0);
        return;
      }
      if (!target.exempt) {
        const blocked = list.find((entry) => !isPublicAddress(entry.address));
        if (blocked) {
          callback(
            new SsrfBlockedError("private_address", "The hostname resolves to a private or reserved address."),
            "",
            0,
          );
          return;
        }
      }
      if ((options as { all?: boolean }).all) {
        (callback as unknown as (err: null, addresses: typeof list) => void)(null, list);
        return;
      }
      const wanted = (options as { family?: number }).family;
      const chosen = list.find((entry) => !wanted || entry.family === wanted) ?? list[0];
      if (!chosen) {
        callback(Object.assign(new Error(`No addresses found for ${hostname}`), { code: "ENOTFOUND" }), "", 0);
        return;
      }
      callback(null, chosen.address, chosen.family);
    });
  };
  return pinned;
}

/**
 * Save-time check: URL policy plus one DNS resolution, so a user gets
 * immediate feedback for a hostname that points somewhere private. This is a
 * courtesy, not the control: the pinned lookup re-validates on every request.
 */
export async function assertTargetAllowed(input: string, policy: SsrfPolicy = defaultSsrfPolicy()): Promise<ValidatedTarget> {
  const target = validateTargetUrl(input, policy);
  if (target.exempt || ipaddr.isValid(stripBrackets(target.hostname))) return target;
  await new Promise<void>((resolve, reject) => {
    dnsLookup(target.hostname, { all: true, verbatim: true }, (error, addresses) => {
      // An unresolvable name is not a policy violation; the monitor will simply report a DNS error.
      if (error) return resolve();
      const blocked = addresses.find((entry) => !isPublicAddress(entry.address));
      if (blocked) {
        return reject(new SsrfBlockedError("private_address", "That hostname resolves to a private or reserved address."));
      }
      resolve();
    });
  });
  return target;
}
