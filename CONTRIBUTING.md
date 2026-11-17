# Contributing

PulseOps is created and maintained by [Nuhan Habib](https://github.com/nuhanhabib). Thanks for taking a look. This is a small project, so the process is light.

## Getting set up

Follow the manual setup in the [README](README.md#manual-setup). You need Node 22, PostgreSQL 16, and Redis 7.

```bash
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

## Before you open a pull request

```bash
npm run lint
npm run typecheck
npm test                 # unit, integration, component
npm run build && npm run test:e2e
```

CI runs the same commands.

## Conventions

- **Layering.** Route handlers declare what they need and call a service. Services own authorization, transactions, audit records, and events. Nothing else talks to Prisma.
- **Tenancy.** Every service function that touches tenant data takes an `OrgContext` first and filters by `ctx.organization.id`. A record from another organization is "not found", never "forbidden".
- **The API contract** is `src/shared/types.ts`. Do not return Prisma models from a route.
- **Validation** lives in `src/shared/schemas` and is shared by forms and the API.
- **UI** uses the tokens in `src/app/globals.css` and the components in `src/components/ui`. No raw colours in feature code. Every status needs an icon and a label, not colour alone. Charts follow the rules in `docs/design-system.md`.
- **Tests.** A change to authorization, tenancy, the state machine, or the SSRF guard needs a test that would have failed before it.
- **Schema changes** go through `npm run db:migrate`, with the migration committed.

## Commit messages

Imperative mood, with a conventional prefix (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
