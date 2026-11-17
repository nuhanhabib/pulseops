import http from "node:http";
import https from "node:https";

import { createPinnedLookup, defaultSsrfPolicy, type SsrfPolicy, validateTargetUrl } from "./ssrf";

/**
 * POSTs a JSON body to a user-supplied URL through the SSRF guard. Used for
 * outbound webhooks. Redirects are not followed: a webhook endpoint that
 * redirects is misconfigured, and following it would hand the signed payload
 * to a different host.
 */
export function safePostJson(
  url: string,
  body: string,
  headers: Record<string, string>,
  timeoutMs = 10_000,
  policy: SsrfPolicy = defaultSsrfPolicy(),
): Promise<{ statusCode: number }> {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = validateTargetUrl(url, policy);
    } catch (error) {
      reject(error);
      return;
    }
    const secure = target.url.protocol === "https:";
    const host = target.hostname.replace(/^\[|\]$/g, "");
    const request = (secure ? https : http).request(
      {
        protocol: target.url.protocol, hostname: host, port: target.port, path: `${target.url.pathname}${target.url.search}`,
        method: "POST", agent: false, lookup: createPinnedLookup(target), servername: secure ? host : undefined,
        headers: { ...headers, "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)), Connection: "close" },
      },
      (response) => {
        clearTimeout(timer);
        response.resume();
        resolve({ statusCode: response.statusCode ?? 0 });
      },
    );
    const timer = setTimeout(() => request.destroy(Object.assign(new Error("Webhook request timed out."), { code: "ETIMEDOUT" })), timeoutMs);
    request.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    request.end(body);
  });
}
