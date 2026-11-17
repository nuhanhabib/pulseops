# PulseOps — build progress

Working log for whoever continues this build. `README.md` describes the product; this file describes the state of the work.

## Status

All ten phases are complete. The last full verification run:

| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | clean |
| Types | `npm run typecheck` | clean |
| Unit / integration / component | `npm test` | 121 passed (78 / 30 / 13) |
| Production build | `npm run build` | succeeds |
| Worker bundle | `npm run build:worker` | succeeds; `node dist/worker.mjs` runs |
| End to end | `npm run test:e2e` | 7 passed, against the production build + worker + simulator |
| Dependency audit | `npm audit --omit=dev` | 0 vulnerabilities |

Verified by hand against the running stack: real checks are stored; breaking a simulated service drives DEGRADED → DOWN → automated incident → queued notifications; healing it recovers the monitor and auto-resolves the incident; SSE delivers events and rejects unauthenticated callers; draft status pages disclose nothing.

## Not verified

- **Docker.** No daemon was available. `Dockerfile` and `docker-compose.yml` are written and `docker compose config` passes, but nothing was built or run. First thing to do on a machine with Docker: `docker compose up --build`, fix what surfaces, then remove the "unverified" notes in `README.md` and `docs/deployment.md`.
- **Live AI calls.** No API key was available. The provider typechecks against the installed SDK; the disabled path is tested.
- **Real SMTP delivery.** The "no provider" fallback is verified. Sending through Mailpit depends on the Compose stack.
- **GitHub Actions.** The workflow mirrors the local commands but has not run.

## Environment notes (the sandbox this was built in)

- `service postgresql start && service redis-server start` after any container restart.
- DB role `pulseops` / `pulseops`; databases `pulseops` and `pulseops_test`.
- `@playwright/test` is pinned to 1.63.0 to match the preinstalled browser.

## Decisions (see docs/decisions)

First-party sessions instead of Auth.js; Postgres-owned schedule; SSE as invalidation; transactional outbox; bundled demo simulator; static CSP. Framer Motion was dropped as unnecessary.

## Things worth knowing before changing code

- Next 16.4 has Cache Components on: any `cookies()` / `params` read in a server component must be inside `<Suspense>`. Bundled docs: `node_modules/next/dist/docs/`.
- Next keeps the previous route mounted but hidden after client navigation. In Playwright, prefer `page.goto()` between sections or role queries become ambiguous.
- `@next/env` is CommonJS; `src/server/load-env.ts` handles both export shapes. tsx, esbuild, and Prisma's config loader each import it differently.
- `nulls: "last"` in a Prisma `orderBy` is only valid on nullable columns.
- The sign-in limiter (20 per IP per 15 minutes) will lock out scripts that log in repeatedly. Clear with `redis-cli --scan --pattern 'pulseops:rl:*' | xargs redis-cli del`.

## Suggested next work

See the roadmap in `README.md`. Highest value: verify Docker, add request headers with encrypted storage, add API keys, email the invitation link.
