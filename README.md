# OpsDesk

OpsDesk gives operations, payments, and compliance teams one place to record requests, assign ownership, track decisions, and agree on the next action. It uses a TypeScript React client, a Fastify API, and PostgreSQL. The API enforces team permissions and workflow rules; PostgreSQL transactions keep item changes, append-only history, idempotency responses, and outbox rows consistent.

## What works

- Seeded-user sign-in with an HTTP-only session cookie.
- Team-scoped item creation, server-side search/filtering, cursor pagination, detail, edits, assignment, claim, transition, comments, and activity history.
- Admin/member/viewer permissions enforced in the API.
- Atomic claims, optimistic version checks, repeat-safe mutations, and a transactional outbox worker.
- Responsive dashboard and detail views with loading, empty, network-error, and conflict states.

## Architecture

```mermaid
flowchart LR
  Browser[React + Vite] -->|same-origin requests| Vercel[Vercel static hosting and /api rewrite]
  Vercel -->|/api/*| API[Render Fastify API]
  API -->|Prisma transactions| DB[(PostgreSQL)]
  API -->|same transaction| Outbox[(Outbox rows)]
  Worker[Outbox worker process] -->|SKIP LOCKED polling| Outbox
  Worker -->|deduplicated notification rows| DB
  Contracts[Shared Zod contracts] -.-> API
  Contracts -.-> Browser
```

The browser never connects directly to PostgreSQL. The session is an opaque random token stored in an HTTP-only cookie; only its hash is stored in the database. The API resolves team membership for each resource and applies the centralized policy functions. See [docs/architecture.md](docs/architecture.md) for data flow and trust boundaries.

## Stack

| Area             | Choice                                    | Why                                                                   |
| ---------------- | ----------------------------------------- | --------------------------------------------------------------------- |
| Web              | React, Vite, TypeScript                   | Small static client deployable to a CDN.                              |
| API              | Fastify, TypeScript                       | A clear modular API with request hooks and a single service boundary. |
| Database         | PostgreSQL + Prisma                       | Transactions, constraints, indexed filtering, and relational history. |
| Validation       | Zod shared contracts                      | The API and client use the same domain schemas.                       |
| Sessions         | HTTP-only cookie + bcrypt password hashes | Browser JavaScript cannot read the session token.                     |
| Async processing | PostgreSQL outbox + worker                | A rollback cannot enqueue work for an uncommitted mutation.           |
| Tests            | Vitest, Supertest, React Testing Library  | Policy, workflow, database/API, worker, and UI coverage.              |

This repository keeps the established Fastify/Postgres/React architecture. The original challenge is technology-agnostic, and the existing application already implements its core correctness cases. Moving it to Next.js/Supabase Auth/RLS would be a separate migration, not a deployment fix. Authorization is enforced by the API; this repository does not claim Supabase RLS.

## Repository layout

```text
apps/api/                 Fastify routes, services, auth, Prisma schema, migrations, seed, tests
apps/web/                 React/Vite pages, components, API client, UI tests
packages/contracts/       Shared TypeScript and Zod contracts
docs/                     Challenge checklist and architecture guide
docker-compose.yml        Local PostgreSQL and disposable test database
vercel.json               Static web build output and API rewrite
```

## Prerequisites

- Node.js 20.19 or newer (Node 22 recommended)
- pnpm 10; Corepack can install the version pinned in `package.json`
- Docker Desktop with Docker Compose for local PostgreSQL and the database-backed tests

## Local setup (PowerShell)

Run these commands from the repository root. Copying `.env.example` creates a local-only `.env`; do not commit it.

```powershell
Copy-Item .env.example .env
corepack enable
pnpm install --frozen-lockfile
docker compose up -d db
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open <http://localhost:5173>. The root `pnpm dev` command starts the API, Vite client, and outbox worker. Vite proxies `/api` to Fastify on port 3000. Separate terminal commands are `pnpm dev:api`, `pnpm dev:web`, and `pnpm worker`.

The Compose initialization script creates `opsdesk_test` for integration tests on a fresh Docker volume. If the volume existed before that script was added, create the database once:

```powershell
docker compose exec db psql -U opsdesk -d opsdesk -c "CREATE DATABASE opsdesk_test OWNER opsdesk;"
```

The integration suite migrates and writes only to `TEST_DATABASE_URL`. It never falls back to `DATABASE_URL`, so a missing test URL cannot cause tests to mutate the app database. Keep `TEST_DATABASE_URL` pointed at a disposable database.

## Environment variables

`.env.example` contains local placeholders. Set production values in the hosting provider's secret/environment settings, not in a checked-in file.

| Variable              | Purpose                                                                | Secret?                     |
| --------------------- | ---------------------------------------------------------------------- | --------------------------- |
| `DATABASE_URL`        | PostgreSQL connection used by API/worker/migrations                    | Yes                         |
| `TEST_DATABASE_URL`   | Disposable PostgreSQL database for integration tests                   | Yes; test-only              |
| `SESSION_SECRET`      | HMAC secret used to hash session tokens; at least 32 random characters | Yes                         |
| `WEB_ORIGIN`          | Allowed browser origin for API CORS                                    | No, but deployment-specific |
| `NODE_ENV`            | `development`, `test`, or `production`                                 | No                          |
| `PORT`                | API listen port; hosting providers supply this                         | No                          |
| `SESSION_TTL_HOURS`   | Session lifetime (default `12`)                                        | No                          |
| `SEED_PASSWORD`       | Password used by the optional demo seed                                | Yes                         |
| `OUTBOX_POLL_MS`      | Worker idle polling interval (default `1000`)                          | No                          |
| `OUTBOX_MAX_ATTEMPTS` | Outbox retry limit (default `5`)                                       | No                          |

Generate a production session secret locally with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Production startup fails if `SESSION_SECRET` is missing, uses the checked-in placeholder, or is shorter than 32 characters. It also requires an HTTPS `WEB_ORIGIN`. The demo seed refuses the default `opsdesk-demo` password when `NODE_ENV=production`. Never use the local demo password on a public deployment.

## Database commands

```powershell
pnpm db:generate
pnpm db:migrate       # deploy checked-in migrations using the root .env
pnpm db:migrate:dev   # create a development migration
pnpm db:seed          # seed 3 teams, 8 users, and about 150 items
```

For a one-off remote migration from PowerShell, quote the connection string so PowerShell assigns it as a value. Use the external database URL from the provider dashboard and keep it private:

```powershell
$env:DATABASE_URL = 'postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require'
pnpm --filter @opsdesk/api exec prisma migrate deploy --schema prisma/schema.prisma
Remove-Item Env:DATABASE_URL
```

Use the provider's exact URL and TLS parameters. Do not run tests or `db:seed` against a production database. The seed upserts demo users and resets their passwords, so use it only on a fresh demo database with a unique `SEED_PASSWORD`.

## Demo users

For local development, seeded users use `SEED_PASSWORD` from `.env.example` (default `nk10nikhil`). The login page displays the local demo-user list only in Vite development builds; production builds do not prefill credentials or show the shared demo password.

| Email                   | Team roles                                  |
| ----------------------- | ------------------------------------------- |
| `alex@opsdesk.local`    | Operations admin, Payments member           |
| `blair@opsdesk.local`   | Payments admin, Trust & Compliance viewer   |
| `casey@opsdesk.local`   | Operations member                           |
| `devon@opsdesk.local`   | Payments member, Operations viewer          |
| `emery@opsdesk.local`   | Trust & Compliance member, Payments viewer  |
| `frankie@opsdesk.local` | Trust & Compliance member                   |
| `gray@opsdesk.local`    | Operations viewer, Payments viewer          |
| `harper@opsdesk.local`  | Operations member, Trust & Compliance admin |

## Deploy for a review/demo

The repository uses Vercel for the static React client and Render for the Fastify API and PostgreSQL. The Vercel build is a single static project; do not choose the Vercel **Services** multi-service preset. The checked-in `vercel.json` already supplies the build, output directory, and `/api/*` rewrite.

### 1. Prepare the database

Use a PostgreSQL database and copy its connection string into the API service's `DATABASE_URL`. If using Render Postgres, use its internal connection string when the API is also on Render. Render's free Postgres is for exploration: it has a 1 GB limit and expires 30 days after creation. For a demo that must keep data longer, use a database plan/provider whose retention fits that need. See [Render free instance limits](https://render.com/docs/free).

Apply migrations before sending traffic. From your machine, set `DATABASE_URL` temporarily as shown in the Database commands section and run `prisma migrate deploy`. Do not run the migration command against an empty database until the chosen database URL is confirmed.

### 2. Deploy the API on Render

Create a Render **Web Service** connected to this GitHub repository:

- Root Directory: `.`
- Build Command: `pnpm install --frozen-lockfile --prod=false && pnpm --filter @opsdesk/api build`
- Start Command: `pnpm --filter @opsdesk/api start:combined`
- Health Check Path: `/health/ready` (checks PostgreSQL connectivity and returns no connection details)

Set these environment variables in the Render service:

```text
NODE_ENV=production
DATABASE_URL=<private database connection string>
SESSION_SECRET=<unique random value from the command above>
WEB_ORIGIN=https://<your-vercel-project>.vercel.app
SESSION_TTL_HOURS=12
OUTBOX_POLL_MS=1000
OUTBOX_MAX_ATTEMPTS=5
```

`start:combined` supervises the API and worker as separate Node processes in one Render web service. This allows the demo to run without a separately billed background-worker service. On an always-on paid deployment, use `pnpm --filter @opsdesk/api start` for the web service and `pnpm --filter @opsdesk/api start:worker` for a separate worker.

### 3. Deploy the web client on Vercel

Import the repository as a **single project** with these settings:

- Root Directory: `./` (repository root)
- Application Preset: **Other** (or Vite if Vercel offers it for the root project; do not select Services)
- Install Command: `pnpm install --frozen-lockfile --prod=false`
- Build Command: `pnpm --filter @opsdesk/web build`
- Output Directory: `apps/web/dist`

These values are already in [vercel.json](vercel.json). Its ordered rewrites send `/api/*` to Render and serve `index.html` for client-side routes such as `/work-items/:id`. The Vercel project must use repository root because the output path is relative to that root. If Vercel's Render API host differs from the current `destination` in `vercel.json`, change the public hostname and push the change before deploying.

Vercel needs no database credentials: browser requests to `/api/*` are rewritten to Render. After the first deploy, set `WEB_ORIGIN` on Render to the production Vercel origin, then redeploy the API. Confirm the host-only session cookie is `Secure`, `HttpOnly`, and `SameSite=Strict` in browser devtools.

### 4. Seed a review database (optional)

For a disposable assessment/demo database, set `DATABASE_URL`, `NODE_ENV=production`, and a unique `SEED_PASSWORD` in a local shell, then run `pnpm --filter @opsdesk/api db:seed`. Share that password only with intended reviewers. Do not enable the seed command as an automatic deploy step or run it against real operational data.

### 5. Smoke-test the deployment

- Open the Vercel URL and sign in with the intended demo account.
- Search for a seeded item; verify the team/status/priority filters and **Load more**.
- Open an item, add a comment, claim/assign it, and confirm the timeline updates.
- Open the same unassigned item in two browser profiles and claim from both; one should succeed and one should show the claim conflict.
- Sign in as a viewer and confirm create/claim/transition are denied by the API.
- Check Render logs for a healthy API and outbox worker; `/health` is a liveness check and `/health/ready` verifies PostgreSQL connectivity without exposing failure details.
- Confirm browser requests remain on the Vercel origin and `/api` requests reach the configured Render service.

### Free-tier caveats

Treat free hosting as a personal, non-commercial review deployment, not production. Vercel Hobby is restricted to personal, non-commercial use; use a plan permitted by your actual use case. Render free web services can spin down after inactivity, and Render free Postgres expires after 30 days. Because the demo co-locates the outbox worker with the web service, queued secondary work waits while that service sleeps. Provider quotas and policies change, so recheck the [Vercel Hobby terms](https://vercel.com/docs/plans/hobby) and [Render free limits](https://render.com/docs/free) before deployment. These free tiers do not imply capacity for hundreds of concurrent employees.

## Tests and checks

```powershell
pnpm format:check
pnpm typecheck
pnpm test:unit
pnpm test
pnpm build
```

| Risk                                                                  | Coverage                               | Command          |
| --------------------------------------------------------------------- | -------------------------------------- | ---------------- |
| Viewer/member/admin permission boundaries                             | Policy unit tests                      | `pnpm test:unit` |
| Legal and illegal workflow transitions                                | Workflow matrix unit tests             | `pnpm test:unit` |
| Concurrent claims, stale edits, resource isolation, idempotent replay | Fastify + PostgreSQL integration tests | `pnpm test`      |
| Outbox retry/deduplication and cursor stability                       | Fastify + PostgreSQL integration tests | `pnpm test`      |
| Login and conflict UI states                                          | React Testing Library                  | `pnpm test:unit` |
| Type correctness                                                      | TypeScript                             | `pnpm typecheck` |
| Production client and API bundles                                     | Vite + TypeScript builds               | `pnpm build`     |

`pnpm test` requires a reachable disposable database in `TEST_DATABASE_URL`; CI starts PostgreSQL and runs the full suite. Without that variable, the database integration suite is skipped while unit and UI tests still run. Never point `TEST_DATABASE_URL` at production.

## Authorization summary

| Action                                           | Viewer | Member | Admin |
| ------------------------------------------------ | ------ | ------ | ----- |
| Read items/history in a team                     | Yes    | Yes    | Yes   |
| Create items/comment/claim unassigned work       | No     | Yes    | Yes   |
| Edit or transition own assigned work             | No     | Yes    | Yes   |
| Assign/reassign and change priority for any item | No     | No     | Yes   |
| Close/reopen and transition any item             | No     | No     | Yes   |

Every resource route resolves membership for the item's team; the client does not supply an authoritative role. The application uses centralized server-side authorization and does not expose PostgreSQL credentials to the browser.

## Project notes

- [Engineering decisions](ENGINEERING_DECISIONS.md)
- [Known limitations](KNOWN_LIMITATIONS.md)
- [Challenge checklist](docs/requirements-checklist.md)
- [Architecture](docs/architecture.md)

Live demo: **[OpsDesk](https://newtonite-opsflow.vercel.app/)**

User: `alex@opsdesk.local` (from `Demo User table` above)

Password: `nk10nikhil` (from `.env.example`)