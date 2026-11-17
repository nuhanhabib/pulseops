# Security

What PulseOps protects against, how, and where the protection stops.

## Authentication and sessions

- Passwords are hashed with **argon2id** (19 MiB, 2 iterations, 1 lane; the OWASP minimum). Policy: 10 to 128 characters, letters plus a number or symbol, a small breached-password denylist, not equal to the email.
- A session is an opaque 256-bit random token in a cookie. The database stores only its SHA-256, so a database leak does not yield usable sessions.
- The cookie is `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` whenever `APP_URL` is HTTPS.
- Sessions are server-side rows: sign-out, password change (which revokes all other sessions), and per-device revocation take effect immediately. Sessions slide for `SESSION_TTL_DAYS` and expired rows are pruned.
- Sign-in returns one message for "unknown account" and "wrong password", and burns equal CPU for both. Attempts are rate limited per IP and per account; the limits fail closed if Redis is unavailable.

Not implemented: email verification, password reset by email, multi-factor authentication, single sign-on.

## Authorization and tenant isolation

- One permission table (`src/shared/permissions.ts`) maps roles to permissions. Services call `authorize(ctx, permission)`; the UI reads the same table only to decide what to render.
- An `OrgContext` can only be obtained by proving membership. Every tenant query filters by its organization id.
- A record in another organization, and an organization you are not in, both return **404**, so identifiers and slugs cannot be probed.
- Admins can manage only roles below their own. An organization always keeps at least one owner; the check takes a row lock so concurrent demotions cannot race.
- The SSE stream is authorized like any route and its channel name comes from the verified membership.

Covered by `tests/integration/auth-and-tenancy.test.ts`.

## CSRF

State-changing requests must carry an `Origin` matching the request host or `APP_URL`, or a same-origin `Sec-Fetch-Site`. Combined with `SameSite=Lax` cookies and JSON-only request bodies. Requests with neither header are not from a browser and carry no ambient credentials.

## SSRF

Users supply URLs that the platform fetches (monitor checks, test checks, webhooks). `src/server/monitoring/ssrf.ts` applies three layers to every request and every redirect hop:

1. **URL policy.** `http`/`https` only; no credentials in the URL; ports 80, 443, or above 1023; no internal hostnames (`localhost`, `*.local`, `*.internal`, `metadata.google.internal`, single-label names, …); literal IPs must be public. The WHATWG URL parser canonicalizes decimal, octal, and hex IPv4 forms first, so `http://2130706433/` is seen as `127.0.0.1`.
2. **Address policy.** After DNS resolution, every returned address must be global unicast. Loopback, RFC 1918, link-local (which covers `169.254.169.254`), CGNAT, unique-local IPv6, multicast, reserved ranges, IPv4-mapped IPv6, and NAT64 addresses embedding a private IPv4 are refused. If any record is private, the whole lookup is refused.
3. **Pinned connection.** The vetted addresses are handed to the socket through Node's `lookup` hook. There is no second resolution between the check and the connect, which is the gap DNS rebinding uses.

Redirects are followed manually (at most 5), with all three layers re-applied per hop, and HTTPS-to-HTTP downgrades refused. Response bodies are not read. Query strings are never stored. Webhooks do not follow redirects at all.

Covered by `tests/unit/ssrf.test.ts` and `tests/integration/monitoring.test.ts`.

### Known limits

This is defence in depth at the application layer, not a proof.

- **No network-level egress control.** Run the worker in a network segment that cannot reach internal services or the metadata endpoint, and enforce IMDSv2 on AWS. Treat the application guard as the second line.
- **Outbound proxies are not supported.** If the worker's traffic goes through an HTTP proxy, the proxy resolves names and the pinning does not apply.
- **The address list is a snapshot.** It relies on `ipaddr.js` range tables; a newly assigned special range would need a library update. The guard allowlists "unicast" rather than blocklisting ranges, so unknown special ranges fail closed.
- **Public-to-public abuse.** The guard stops access to private networks; it does not stop someone pointing a monitor at a third party's public site. Minimum intervals, per-organization monitor limits, and rate-limited test checks bound this.
- **`MONITOR_ALLOWED_PRIVATE_HOSTS`** is a deliberate hole for the listed `host[:port]` entries. It exists for the demo simulator and for self-hosters monitoring their own internal services. Leave it empty otherwise.

## Public status pages

`getPublicStatusPage` is the only code that produces data for anonymous visitors. It is an allowlist: it selects exactly the columns it publishes and builds a dedicated DTO. It never reads monitor URLs or private names, internal notes, system-generated timeline entries, assignees, or member data, and treats unpublished pages as missing. A test seeds secrets into every private field and asserts none appear in the output.

Note that publishing an incident publishes its **title** as written. Automatically opened incidents are titled after the monitor's private name ("Checkout API is down"); rename the incident before making it public if that name is sensitive. Incidents are private by default.

Because the page streams, an unknown or unpublished slug renders the not-found page with HTTP 200 rather than 404. No content is disclosed.

## AI assistant

Off unless `AI_PROVIDER` and `ANTHROPIC_API_KEY` are set. The key is read from the environment only. The model receives aggregates and sanitized error categories; URLs, IP addresses, emails, and token-like strings are stripped, monitors are referred to by position, and internal notes are never read. Timeline text is passed as data with an instruction not to follow it. Output is schema-validated before storage, rate limited per organization (failing closed), capped in tokens, and labelled as AI-generated. The feature can write only an `IncidentAnalysis` row.

## Other controls

- **Input validation**: Zod on every body and query; sort fields are enums; request bodies capped at 100 KB.
- **XSS**: React escaping throughout; no user-supplied HTML is rendered; notification emails escape every interpolated value.
- **Headers**: CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP, and HSTS over HTTPS. The CSP allows inline scripts (see [ADR 0006](decisions/0006-content-security-policy.md)).
- **Rate limiting**: sign-in, sign-up, password change, writes per user, test checks, invitations, AI, public status API, and notifications per destination.
- **Audit log**: append-only record of configuration, membership, and incident changes. Metadata is sanitized; credential-like keys are redacted.
- **Logging**: structured JSON with a redaction list; request bodies are never logged.
- **Webhooks**: signed with HMAC-SHA256 over `timestamp.body`; the secret is shown once.
- **Redirects**: post-login `next` targets must be same-site paths.
- **Secrets**: `.env` is git-ignored; nothing secret is committed. The seed's demo password is a documented demo credential and the seed refuses to run with `NODE_ENV=production` unless explicitly allowed.

## Operational notes

- Deploy behind a reverse proxy that sets `X-Forwarded-For`, and set `TRUSTED_PROXY_HOPS`. Without a proxy a client can spoof that header and dodge per-IP limits (per-account limits still apply).
- Do not expose Postgres, Redis, or the worker's health port publicly.
- CI runs `npm audit --omit=dev`. At the time of writing it reports 0 vulnerabilities in production dependencies; the moderate advisories `npm audit` lists without that flag are all in development tooling.
