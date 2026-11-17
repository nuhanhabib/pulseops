# API reference

Base path: `/api/v1`. JSON in, JSON out.

## Conventions

**Authentication.** A session cookie, set by `POST /auth/login` or `/auth/register`. There are no API keys yet.

**Tenancy.** Organization resources live under `/orgs/{orgSlug}/…`. If you are not a member, every path under it returns `404`.

**Writes** must be sent as `application/json` and, from a browser, same-origin.

**Success envelope**

```json
{ "data": { } }
```

**Error envelope**

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Some fields need attention.",
    "fields": { "url": ["Enter a full URL, including https://."] },
    "requestId": "0d3c…"
  }
}
```

| Code | Status | Meaning |
|---|---|---|
| `bad_request` | 400 | Malformed JSON |
| `unauthenticated` | 401 | No valid session |
| `forbidden` | 403 | Your role does not allow this |
| `csrf_rejected` | 403 | Cross-site write |
| `not_found` | 404 | Missing, or not in your organization |
| `conflict` | 409 | Duplicate or invalid state |
| `payload_too_large` | 413 | Body over 100 KB |
| `unsupported_media_type` | 415 | Body is not JSON |
| `validation_failed` | 422 | See `fields` |
| `rate_limited` | 429 | The message says how long to wait; see `Retry-After` |
| `internal_error` | 500 | Logged with `requestId` |
| `upstream_error` | 502 | AI provider failed |
| `feature_disabled` | 503 | AI not configured |
| `service_unavailable` | 503 | Redis is unreachable and the limit guarding this route fails closed |

Every response has `X-Request-Id`.

**Pagination.** Offset lists take `page`, `pageSize` (max 100) and return `{ items, page, pageSize, total, totalPages }`. Cursor lists take `cursor`, `limit` and return `{ items, nextCursor }`.

**Time ranges.** `range` is `24h`, `7d`, `30d`, or `90d`.

## Auth and account

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/register` | `{ name, email, password, organizationName, invitationToken? }` |
| POST | `/auth/login` | `{ email, password }` |
| POST | `/auth/logout` | Revokes the session |
| GET, PATCH | `/me` | Profile and memberships; `{ name }` |
| POST | `/me/password` | `{ currentPassword, newPassword }`; revokes other sessions |
| GET, DELETE | `/me/sessions` | List; sign out all other devices |
| DELETE | `/me/sessions/{id}` | Sign out one device |
| GET, POST | `/orgs` | List memberships; create `{ name, slug? }` |
| GET, POST | `/invitations/{token}` | Public preview; accept (signed in as the invited address) |

```bash
curl -c jar -X POST http://localhost:3000/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"demo@northwind.example","password":"pulseops-demo-2026"}'
# {"data":{"user":{"id":"…","email":"demo@northwind.example","name":"Avery Chen"},"orgSlug":"northwind-demo"}}
```

## Organization (`/orgs/{orgSlug}`)

| Method | Path | Permission |
|---|---|---|
| GET / PATCH / DELETE | `` | `org:read` / `org:update` / `org:delete` (`{ confirm: slug }`) |
| GET | `/members` | `member:read` |
| PATCH / DELETE | `/members/{id}` | `member:manage` (any member may delete themselves) |
| GET, POST | `/invitations` | `member:manage`; POST returns the single-use `inviteUrl` once |
| DELETE | `/invitations/{id}` | `member:manage` |
| GET | `/dashboard?range=` | `monitor:read` |
| GET | `/analytics?range=` | `monitor:read` |
| GET, POST | `/activity` | Feed (cursor); POST marks it read |
| GET | `/audit-log?q=&action=` | `audit:read` |
| GET | `/search?q=` | `monitor:read` |
| GET | `/stream` | Server-Sent Events |
| GET | `/ai` | Whether the assistant is configured |

## Monitors

| Method | Path | Permission |
|---|---|---|
| GET | `/monitors?q=&status=&kind=&category=&sort=&direction=&page=` | `monitor:read` |
| POST | `/monitors` | `monitor:write` |
| POST | `/monitors/test` | `monitor:write`; one unsaved check, 12 per minute |
| GET | `/monitors/categories` | `monitor:read` |
| GET / PATCH / DELETE | `/monitors/{id}` | read / write / `monitor:delete` |
| POST | `/monitors/{id}/check` | `monitor:write`; run as soon as possible |
| GET | `/monitors/{id}/checks?status=&cursor=` | `monitor:read` |
| GET | `/monitors/{id}/stats?range=` | `monitor:read` |

```bash
curl -b jar -X POST http://localhost:3000/api/v1/orgs/northwind-demo/monitors \
  -H 'content-type: application/json' -H 'origin: http://localhost:3000' \
  -d '{"name":"Docs","url":"https://example.com","intervalSeconds":60}'
```

```json
{ "data": { "id": "0192…", "name": "Docs", "url": "https://example.com", "method": "GET",
            "intervalSeconds": 60, "timeoutMs": 10000, "expectedStatusCodes": "200-299",
            "failureThreshold": 3, "recoveryThreshold": 2, "status": "PENDING", "enabled": true } }
```

A private target is rejected:

```json
{ "error": { "code": "validation_failed", "fields": { "url": ["Private, loopback, and link-local addresses cannot be monitored."] } } }
```

Fields: `name`, `url`, `kind` (`WEBSITE`|`API`), `method` (`GET`|`HEAD`|`POST`|`OPTIONS`), `category`, `intervalSeconds` (30–86400), `timeoutMs` (1000–30000), `expectedStatusCodes` (e.g. `200-299,301`), `followRedirects`, `retries` (0–3), `degradedThresholdMs`, `failureThreshold`, `recoveryThreshold`, `autoIncident`, `incidentSeverity`, `enabled`. `timeoutMs × (retries + 1)` must fit inside the interval.

## Incidents

| Method | Path | Permission |
|---|---|---|
| GET | `/incidents?state=&status=&severity=&assigneeId=&monitorId=&q=` | `incident:read` |
| POST | `/incidents` | `incident:write` |
| GET / PATCH / DELETE | `/incidents/{id}` | read / write / `incident:delete` |
| POST | `/incidents/{id}/updates` | `{ message, status?, isPublic? }`. `status: "RESOLVED"` resolves. |
| POST | `/incidents/{id}/notes` | `{ body }`, internal only |
| PUT | `/incidents/{id}/monitors` | `{ monitorIds }` |
| GET | `/incidents/{id}/activity` | Field-level history |
| GET, POST | `/incidents/{id}/analyses` | `incident:read` / `ai:use` |

## Status pages and notifications

| Method | Path | Permission |
|---|---|---|
| GET, POST | `/status-pages` | `statuspage:read` / `statuspage:write` |
| GET / PATCH / DELETE | `/status-pages/{id}` | read / write |
| GET | `/notifications` | Preferences, channels, whether email is configured |
| PUT | `/notifications/preferences` | Your own four toggles |
| POST | `/notifications/channels` | `notification:manage`; webhook secret returned once |
| PATCH / DELETE | `/notifications/channels/{id}` | `notification:manage` |
| POST | `/notifications/channels/{id}/rotate-secret` | `notification:manage` |
| GET | `/notifications/deliveries?status=` | `notification:read` |

### Webhook payload

```
POST <your url>
X-PulseOps-Event: INCIDENT_CREATED
X-PulseOps-Delivery: <uuid>
X-PulseOps-Timestamp: 1767225600
X-PulseOps-Signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<body>" with the channel secret>
```

```json
{ "id": "…", "event": "INCIDENT_CREATED", "occurredAt": "2026-01-01T00:00:00.000Z",
  "summary": "Incident INC-12 opened", "link": "https://…/org/acme/incidents/…",
  "organization": { "name": "Acme", "slug": "acme" },
  "monitor": { "id": "…", "name": "Checkout API", "url": "https://…" },
  "incident": { "id": "…", "number": 12, "title": "Checkout API is down", "severity": "HIGH", "status": "INVESTIGATING" } }
```

Respond with any 2xx within 10 seconds. Other responses are retried up to five times with exponential backoff.

## Public

| Method | Path | Notes |
|---|---|---|
| GET | `/public/status/{slug}` | Published pages only; rate limited; cacheable for 15 s |
| GET | `/health` | `{ status, database, redis }` |

## Real-time events

`GET /orgs/{orgSlug}/stream` emits `data: {json}` lines. Events carry identifiers only; refetch through the REST API.

`monitor.checked`, `monitor.status_changed`, `monitor.changed`, `incident.created`, `incident.updated`, `incident.resolved`, `activity.created`, `notification.updated`, `statuspage.changed`.
