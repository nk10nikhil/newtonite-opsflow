# Challenge requirements and implementation checklist

The source brief is `SDE_Challenge.pdf` (six pages). It defines the product and correctness goals but does not require a particular framework or cloud provider. The implementation keeps the repository's established TypeScript, Fastify, Prisma, PostgreSQL, and React/Vite stack.

## Challenge brief

- [x] Coordinate multi-team operational work through durable work items.
- [x] Show context, state, priority, responsible person, previous activity, and a suggested next action.
- [x] Enforce team membership and role permissions in the API.
- [x] Preserve important workflow, assignment, priority, and comment actions in append-only history.
- [x] Handle competing claims atomically and stale edits with versions.
- [x] Support repeat-safe mutations with stored idempotency responses.
- [x] Search, filter, and cursor-page work on the server; cap page size at 100.
- [x] Persist secondary work in a PostgreSQL outbox and process it with retry/backoff and deduplication.
- [x] Cover risky behavior with policy, workflow, API/PostgreSQL, worker, pagination, and UI tests.
- [x] Document architecture, trade-offs, setup, and limitations.

## Implementation evidence

- API routes and domain operations: `apps/api/src/modules/work-items/`.
- Centralized role policies: `apps/api/src/authz/policies.ts`.
- Relational schema and append-only event trigger: `apps/api/prisma/`.
- Database/API acceptance tests: `apps/api/test/work-items.integration.test.ts`.
- Client flows: `apps/web/src/pages/` and `apps/web/src/components/`.
- Deployment settings: `vercel.json`, Render service commands in `README.md`.

## Deployment and verification risks

- Vercel must use the repository root (`./`) because its build output is `apps/web/dist`; the repo is a monorepo, so choose a normal static/Vite project rather than Vercel's multi-service preset.
- The Vercel rewrite points at the Render API hostname in `vercel.json`; update that public hostname if the Render service URL changes.
- Render must receive the correct production `DATABASE_URL`, a unique `SESSION_SECRET` of at least 32 characters, and the deployed web origin. Apply Prisma migrations before the API serves traffic.
- The free Render web service can sleep when idle. The API and worker can share one web service for a demo, so queued notifications wait while that service sleeps. Use an always-on service and a separate worker for ongoing production operation.
- The database-backed suite requires a reachable disposable PostgreSQL database through `TEST_DATABASE_URL`. Never point it at production.
