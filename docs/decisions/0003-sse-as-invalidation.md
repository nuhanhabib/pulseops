# 3. Real-time events are invalidation signals over SSE

**Status:** accepted

## Context

Live updates could push full records over WebSockets. That creates a second path by which data reaches the browser, with its own authorization and serialization to keep correct.

## Decision

Use Server-Sent Events. Events carry a type and identifiers only. The client marks the matching TanStack Query caches stale and refetches through the REST API.

## Consequences

- One code path enforces access control and shapes data.
- A missed or duplicated event costs a refetch, never correctness. After a reconnect the client refetches everything.
- SSE works through ordinary HTTP infrastructure and reconnects on its own.
- Slightly more requests than pushing payloads. Invalidations are batched to keep that small.
- Communication is one-way, which is all this needs.
