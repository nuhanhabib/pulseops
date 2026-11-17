# 5. A bundled simulator for demo monitors

**Status:** accepted

## Context

A demo needs monitors that return results. Pointing them at real third-party sites makes the demo depend on the internet, puts load on other people's servers, and would mean attaching fabricated outage history to real companies' names. Pointing them at fictional hostnames means every live check fails.

## Decision

Ship a small HTTP server (`scripts/demo-targets.ts`) that plays ten fictional services, with realistic latency and a control endpoint for injecting failures. Seeded monitors point at it. Seeded history is tagged `SEED`; everything the worker records afterwards is a genuine `LIVE` result of a real HTTP request.

## Consequences

- The demo works offline and a reviewer can trigger a real outage and watch the whole pipeline respond.
- No fabricated row is presented as a measurement.
- The simulator's host must be on `MONITOR_ALLOWED_PRIVATE_HOSTS`, which is exactly the kind of exemption production should not have. The setting is documented as demo-only and empty by default in the schema.
