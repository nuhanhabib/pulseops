# 2. Postgres owns the schedule; BullMQ executes

**Status:** accepted

## Context

BullMQ can hold the schedule itself, with one repeatable job per monitor. That puts the schedule in two places: the monitor row in Postgres and a scheduler entry in Redis. Every create, edit, pause, and delete then has to update both, and any failure between the two leaves them disagreeing. A Redis flush would silently stop all monitoring.

## Decision

`Monitor.nextCheckAt` is the schedule. The worker claims due rows with `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)` and enqueues a deduplicated BullMQ job per monitor. BullMQ is used for what it is good at: concurrency, retries, backoff, and stalled-job recovery.

## Consequences

- Monitor CRUD is a single database write.
- Workers scale horizontally without leader election.
- Redis holds no durable state.
- Check timing has up to one tick (2 seconds by default) of jitter.
- One indexed query runs per tick per worker.
