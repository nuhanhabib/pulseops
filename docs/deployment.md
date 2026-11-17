# Deployment

PulseOps is four things to run: the **web app**, the **worker**, **PostgreSQL**, and **Redis**.

> The worker must run continuously, as its own process. It is not a cron job and cannot be replaced by scheduled serverless invocations: checks run as often as every 30 seconds, hold open connections, and depend on in-order processing per monitor. If the worker is down, no checks run and no notifications are delivered. The web app keeps serving, showing data that stops updating.

## Images

One `Dockerfile`, two targets.

```bash
docker build --target web    --build-arg APP_URL=https://pulseops.example.com -t pulseops-web .
docker build --target worker -t pulseops-worker .
```

`APP_URL` is a build argument for the web image because security headers (HSTS, `upgrade-insecure-requests`) are fixed at build time. It must also be set at runtime.

The worker image contains the Prisma CLI and the bundled seed, so it is also what you run migrations with.

> Not verified in the environment this project was built in: no Docker daemon was available, so the images and `docker-compose.yml` were written and syntax-checked (`docker compose config`) but never built or started. The same commands the images run (`next build`, the standalone server's inputs, `node dist/worker.mjs`, `prisma migrate deploy`, `node dist/seed.mjs`) were each run and verified directly.

## Order of operations

1. Start PostgreSQL 16 and Redis 7.
2. Apply migrations: `npx prisma migrate deploy` (in the worker image). Run this as a release step before starting new code.
3. Start the web app and at least one worker.

Migrations are forward-only. Take a database backup before applying one in production.

## Required configuration

See `.env.example` for the full list. The minimum:

| Variable | Web | Worker | |
|---|---|---|---|
| `DATABASE_URL` | ✓ | ✓ | |
| `REDIS_URL` | ✓ | ✓ | |
| `APP_URL` | ✓ | ✓ | Public HTTPS origin. Used for cookies, CSRF, and links in notifications. |
| `SMTP_URL`, `EMAIL_FROM` | | ✓ | Optional. Without it, emails are logged as "not sent". |
| `MONITOR_ALLOWED_PRIVATE_HOSTS` | ✓ | ✓ | **Leave empty** unless you intend to monitor private hosts. |
| `TRUSTED_PROXY_HOPS` | ✓ | | Number of proxies appending to `X-Forwarded-For`. |
| `AI_PROVIDER`, `ANTHROPIC_API_KEY` | ✓ | | Optional. |

Both processes validate their environment at startup and exit with a list of problems if it is invalid.

**Secrets** belong in your platform's secret store, injected as environment variables. Nothing secret is read from disk or stored in the database, except webhook signing secrets (which must be readable to sign) and password and token hashes.

## PostgreSQL

- Version 16 or later (uses `date_bin`, `percentile_disc`).
- Size the pool: each web instance uses up to `DATABASE_POOL_MAX` connections (default 10). Give workers at least `WORKER_CONCURRENCY` (default 20) by setting `DATABASE_POOL_MAX` on the worker.
- `MonitorCheck` is the large table: roughly `monitors × 86400 ÷ interval` rows per day, pruned after `CHECK_RETENTION_DAYS`.

## Redis

- Set `maxmemory-policy noeviction`. BullMQ needs its keys to survive.
- Persistence is useful but not critical: schedules and pending notifications live in Postgres and are re-enqueued.
- Do not share the database index with another application's keys.

## Worker

- Run one or more replicas. They coordinate through Postgres row locks and BullMQ, with no leader.
- Throughput is roughly `WORKER_CONCURRENCY ÷ average check duration` checks per second per replica.
- Set `WORKER_HEALTH_PORT` to expose `GET /healthz` for your orchestrator.
- It shuts down gracefully on `SIGTERM`: stops claiming work, finishes in-flight jobs, closes connections. Allow about 30 seconds.
- **Network placement matters.** Put the worker where it can reach the public internet but not your internal services or cloud metadata endpoint. See [security.md](security.md#known-limits).

## Web app

- Stateless; run any number of instances behind a load balancer.
- Terminate TLS in front of it and forward `X-Forwarded-For`, `X-Forwarded-Host`, and `X-Forwarded-Proto`.
- The SSE endpoint holds connections open for up to ten minutes. Disable response buffering for `/api/v1/orgs/*/stream` (the app sends `X-Accel-Buffering: no`) and set proxy read timeouts above 30 seconds (a heartbeat is sent every 25).
- Health check: `GET /api/v1/health`.

## Logging

Both processes write one JSON object per line to stdout, with `level`, `time`, `service` (`web` or `worker`), and `msg`. API requests include `requestId`, `method`, `path`, `status`, `durationMs`, `userId`, and `orgId`. Collect stdout with your platform's log driver. Sensitive keys are redacted; request bodies are never logged. Set `LOG_LEVEL` to tune volume.

## Where to host it

Any platform that runs containers and long-lived processes works: a VM with Docker Compose, Fly.io, Railway, Render, ECS, Kubernetes. A platform that only runs request-scoped functions can host the web app but **not** the worker; run the worker elsewhere, pointed at the same Postgres and Redis.

## Production checklist

- [ ] `APP_URL` is HTTPS and matches the public origin
- [ ] `MONITOR_ALLOWED_PRIVATE_HOSTS` is empty
- [ ] The demo seed was not run (`SEED_DEMO` unset; no `demo-targets` service)
- [ ] `ALLOW_SIGNUP=false` if the instance is private
- [ ] Postgres and Redis are not publicly reachable; backups are configured
- [ ] At least one worker is running and its health check is monitored
- [ ] The worker's egress cannot reach internal networks
- [ ] Redis uses `noeviction`
