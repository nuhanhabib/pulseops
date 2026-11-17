/**
 * Demo target simulator.
 *
 * A tiny HTTP server that plays the part of ten fictional services, so the
 * demo workspace has something real to monitor without depending on the
 * internet or on anyone else's website. The worker performs genuine HTTP
 * checks against it; nothing about the results is faked.
 *
 * Break a service to watch detection, incident creation, notification, and
 * recovery end to end:
 *
 *   npm run demo:ctl -- break checkout-api 3     # fail for 3 minutes
 *   npm run demo:ctl -- slow search-api 5        # respond slowly for 5 minutes
 *   npm run demo:ctl -- heal checkout-api
 *   npm run demo:ctl -- status
 *
 * The control endpoints accept loopback connections only.
 */
import http from "node:http";

import { DEMO_SERVICES } from "./demo-services";

type Mode = "ok" | "down" | "slow" | "flaky" | "timeout";
const state = new Map<string, { mode: Mode; until: number }>();
const port = Number(process.env.DEMO_TARGETS_PORT ?? 4010);

const modeOf = (slug: string): Mode => {
  const entry = state.get(slug);
  if (!entry) return "ok";
  if (entry.until && Date.now() > entry.until) {
    state.delete(slug);
    return "ok";
  }
  return entry.mode;
};

const isLoopback = (address: string | undefined) => address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
const json = (response: http.ServerResponse, status: number, body: unknown) =>
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(body));

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  const control = /^\/_control(?:\/([a-z0-9-]+))?$/.exec(url.pathname);

  if (control) {
    // In Docker the host reaches this through a port published on 127.0.0.1 only, so the source is the bridge, not loopback.
    if (!isLoopback(request.socket.remoteAddress) && process.env.DEMO_CONTROL_OPEN !== "true") return void json(response, 403, { error: "control endpoints are loopback-only" });
    if (request.method === "GET") {
      return void json(response, 200, DEMO_SERVICES.map((service) => ({ slug: service.slug, name: service.name, mode: modeOf(service.slug) })));
    }
    const slug = control[1];
    if (request.method === "POST" && slug && DEMO_SERVICES.some((service) => service.slug === slug)) {
      const mode = (url.searchParams.get("mode") ?? "ok") as Mode;
      const minutes = Number(url.searchParams.get("minutes") ?? 0);
      if (mode === "ok") state.delete(slug);
      else state.set(slug, { mode, until: minutes > 0 ? Date.now() + minutes * 60_000 : 0 });
      return void json(response, 200, { slug, mode: modeOf(slug), minutes });
    }
    return void json(response, 404, { error: "unknown service" });
  }

  const match = /^\/services\/([a-z0-9-]+)\/health$/.exec(url.pathname);
  const service = match && DEMO_SERVICES.find((item) => item.slug === match[1]);
  if (!service) return void json(response, 404, { error: "not found" });

  const mode = modeOf(service.slug);
  if (mode === "timeout") return; // never answer; the monitor's timeout decides
  const jitter = service.latencyMs * (0.75 + Math.random() * 0.6);
  const spike = Math.random() < 0.02 ? service.latencyMs * (1.5 + Math.random() * 2) : 0;
  const delay = Math.round(jitter + spike + (mode === "slow" ? 2500 + Math.random() * 1500 : 0));
  const failing = mode === "down" || (mode === "flaky" && Math.random() < 0.5) || Math.random() < service.errorRate;

  setTimeout(() => {
    if (failing) return void json(response, 503, { status: "unavailable", service: service.slug });
    if (request.method === "HEAD") return void response.writeHead(200, { "Cache-Control": "no-store" }).end();
    json(response, 200, { status: "ok", service: service.slug });
  }, delay);
});

server.listen(port, () => console.log(`[demo-targets] simulating ${DEMO_SERVICES.length} services on http://localhost:${port}`));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
