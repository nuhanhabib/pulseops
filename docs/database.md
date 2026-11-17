# Database

PostgreSQL 16, managed with Prisma 7. The schema is `prisma/schema.prisma`; migrations are in `prisma/migrations`.

## Conventions

- **Keys** are UUIDv7: time-ordered (index-friendly, usable as pagination cursors) and safe to expose.
- **Every tenant-owned table has `organizationId`**, even where a join could derive it. Isolation is enforced by filtering on that column, so it must be present and indexed.
- **Timestamps** are `timestamptz`. All SQL bucketing is done in UTC.
- **Enums** are native Postgres enums, shared with the browser through Prisma's generated enum module.

## Tables

| Table | Purpose | Notes |
|---|---|---|
| `User` | Account | Email stored lower-cased and unique. `passwordHash` is argon2id. |
| `Session` | Server-side session | Stores a SHA-256 of the cookie token, never the token. |
| `Organization` | Tenant | `slug` is immutable. `incidentCounter` backs `INC-n` numbers. |
| `OrganizationMember` | Membership + role | Unique `(organizationId, userId)`. Holds personal notification preferences and the activity read marker. |
| `Invitation` | Pending invite | Stores a token hash. Unique `(organizationId, email)`; re-inviting rotates the token. |
| `Monitor` | Configuration and runtime state | `nextCheckAt` is the schedule. Unique `(organizationId, name)`. |
| `MonitorCheck` | One row per check | Append-only, pruned by retention. `origin` is `LIVE` or `SEED`. |
| `MonitorDailyAggregate` | Per-monitor, per-UTC-day rollup | Primary key `(monitorId, day)`. |
| `Incident` | Incident | Unique `(organizationId, number)`. `isPublic` is an explicit opt-in. |
| `IncidentMonitor` | Incident ↔ monitor | Composite key. |
| `IncidentUpdate` | Timeline | `kind` is `UPDATE` (human) or `SYSTEM`. `isPublic` per update. |
| `IncidentNote` | Internal notes | A separate table on purpose (see below). |
| `IncidentAnalysis` | Stored AI analysis | JSON content validated against a schema before insert. |
| `NotificationChannel` | Shared destination | Email list or webhook, with subscribed events. |
| `NotificationDelivery` | Outbox and delivery log | Unique `(organizationId, dedupeKey)`. |
| `StatusPage` | Public page | Globally unique `slug`. |
| `StatusPageMonitor` | Component on a page | `displayName` is the public alias. |
| `AuditLog` | Who did what | Append-only. Actor email is snapshotted. |
| `ActivityEvent` | What happened to the systems | Feeds the dashboard and the activity inbox. |

## Decisions worth explaining

**Internal notes are their own table.** The public status page reads `IncidentUpdate` where `isPublic = true AND kind = 'UPDATE'`. Because notes live in `IncidentNote`, there is no query on the public path that could return one, whatever filter someone forgets.

**The schedule is a column, not a queue entry.** See [architecture.md](architecture.md#scheduling-postgres-decides-what-is-due).

**Incident numbers come from a counter on the organization row.** Incrementing it inside the creating transaction takes a row lock, which makes numbers unique and gap-free under concurrency without a sequence per tenant.

**`MonitorCheck` carries `organizationId`.** Organization-wide dashboards aggregate checks directly; without the column they would join through `Monitor` on every query.

**`AuditLog.actorLabel` is a snapshot.** `actorId` is `SET NULL` on user deletion; the label keeps the trail readable afterwards.

## Indexes

| Index | Serves |
|---|---|
| `Monitor(enabled, nextCheckAt)` | The scheduler's claim query |
| `Monitor(organizationId, status)` | Status counts and filtered lists |
| `MonitorCheck(monitorId, checkedAt DESC)` | Monitor history and per-monitor charts |
| `MonitorCheck(organizationId, checkedAt DESC)` | Organization-wide aggregates |
| `MonitorCheck(checkedAt)` | Retention pruning across tenants |
| `Incident(organizationId, status, startedAt DESC)` | Open-incident lists |
| `NotificationDelivery(status, createdAt)` | The outbox poller |
| `AuditLog(organizationId, createdAt DESC)` and `(organizationId, action, createdAt DESC)` | The audit log and its area filter |
| `ActivityEvent(organizationId, occurredAt DESC)` | The activity feed |

## Deletion behaviour

- Deleting an **organization** cascades to everything it owns, the audit log included.
- Deleting a **monitor** cascades to its checks, rollups, status-page links, and incident links. Incidents themselves remain.
- Deleting an **incident** cascades to its updates, notes, and analyses.
- Deleting a **user** cascades sessions and memberships. References from incidents, updates, notes, and audit entries become `NULL`.
- Deleting a **notification channel** keeps its past deliveries (`SET NULL`).

## Pagination

Bounded lists that need sorting and page numbers (monitors, incidents) use offset pagination with a total. Append-only, potentially large lists (checks, audit log, activity, deliveries) use cursor pagination on a stable `(time DESC, id DESC)` order.

## Migrations

```bash
npm run db:migrate   # development: create and apply
npm run db:deploy    # production: apply pending migrations
```

`prisma generate` runs on `npm install`. The generated client is written to `src/generated/prisma` and is not committed.
