# Presenting this project

Copy for the repository, a portfolio page, and a launch post. Everything here describes what the code does; nothing claims users, customers, or a production deployment.

## GitHub repository

**Name:** `pulseops`

**Description (under 350 characters)**

> Multi-tenant uptime monitoring and incident management. Real HTTP checks from a dedicated worker, automatic incidents, live dashboards, public status pages, signed webhooks. Next.js 16, TypeScript, PostgreSQL, Prisma, Redis, BullMQ.

**Topics**

`uptime-monitoring` `incident-management` `status-page` `observability` `nextjs` `typescript` `postgresql` `prisma` `redis` `bullmq` `tailwindcss` `multi-tenant` `saas` `self-hosted` `server-sent-events`

## Portfolio description

**PulseOps — infrastructure monitoring and incident management**

A full-stack SaaS application I designed and built end to end: a Next.js web app, a separate monitoring worker, PostgreSQL, and Redis.

Organizations add websites and API endpoints; a worker checks them on a schedule, records timings, and runs an outage state machine. Sustained failures open an incident automatically, notify the team by email or signed webhook, and can be published to a public status page. Recovery closes the loop.

The parts I would point a reviewer to:

- **Scheduling without a second source of truth.** Each monitor's next run is a column in Postgres, claimed with `FOR UPDATE SKIP LOCKED`. Workers scale horizontally with no leader, and Redis can be wiped without losing a schedule.
- **Race-free incident automation.** Check results are applied in one transaction under a row lock, so repeated or concurrent failures can never open duplicate incidents. A test fires eight results at once to prove it.
- **An SSRF guard for user-supplied URLs.** URL policy, public-address checks on every DNS answer, and a pinned connection that closes the DNS-rebinding gap, re-applied on every redirect. Its limits are written down.
- **Tenant isolation as structure, not convention.** Services can only run with a context obtained by proving membership. Tests assert that another tenant's records read as "not found" by slug and by id.
- **A transactional outbox** for notifications, so an alert exists if and only if its cause was committed.
- **A design system** with tokens for two themes, accessible components, and charts built to explicit rules (validated colour-blind-safe palette, table view for every chart, no dual axes).

128 automated tests: unit, integration against real Postgres and Redis, component, and end-to-end against the production build.

**Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS 4, PostgreSQL, Prisma 7, Redis, BullMQ, TanStack Query, Zod, Vitest, Playwright, Docker.

## LinkedIn post

> I built PulseOps, an uptime monitoring and incident management platform, as a way to work through the problems that make this kind of system hard.
>
> What it does: checks websites and APIs from a dedicated worker, opens an incident when failures are sustained, notifies the team, updates dashboards live, and publishes a status page.
>
> The parts I learned the most from:
>
> → Keeping the schedule in Postgres and letting the queue only execute. No dual writes, and workers scale without a leader.
> → Making "open an incident if there isn't one" safe under concurrency, with a row lock and a test that tries to break it.
> → Defending against SSRF when users tell your server which URLs to fetch, including DNS rebinding and redirects to metadata endpoints.
> → Treating real-time events as cache invalidation rather than a second data channel.
>
> It is open source, with a seeded demo you can run with one Docker command and break on purpose to watch it respond.
>
> Stack: Next.js, TypeScript, PostgreSQL, Prisma, Redis, BullMQ.
>
> Repository: <link>
>
> I would value feedback, especially on the architecture notes and the security write-up.

## Before publishing

- Replace `<link>` with the repository URL.
- Enable private vulnerability reporting in the repository's security settings, since `SECURITY.md` points to it.
- Build and run the Docker Compose stack once and fix anything that surfaces; then remove the "unverified" notes from the README and `docs/deployment.md`.
- Re-capture screenshots if the UI changes (`docs/screenshots`).
