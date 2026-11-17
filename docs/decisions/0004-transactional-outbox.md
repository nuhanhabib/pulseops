# 4. Notifications use a transactional outbox

**Status:** accepted

## Context

Enqueueing a notification job after committing a state change can lose the notification if the process dies in between. Enqueueing before committing can notify about something that then rolls back.

## Decision

Write `NotificationDelivery` rows in the same transaction as the change that causes them, with a unique idempotency key per occurrence and recipient. The worker polls for pending rows and delivers them through BullMQ with retries.

## Consequences

- A notification exists if and only if its cause was committed.
- Re-processing an event cannot notify twice.
- The same table is the delivery log users see.
- The web app has no queue client.
- Delivery lags the event by up to the poll interval (3 seconds).
