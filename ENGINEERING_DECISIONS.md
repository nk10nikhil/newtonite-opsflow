# Engineering decisions

## 1. Keep a modular monolith and the existing stack

**Context.** The challenge is a one-day assessment that values consistency, clear trade-offs, and an easy local setup. The repository already had a TypeScript/Fastify API, React/Vite client, Prisma schema, and PostgreSQL migrations.

**Decision.** Keep the API, client, and worker in one pnpm monorepo with PostgreSQL as the source of truth. Deploy the static client to Vercel and the API to Render. Keep the existing application session model instead of replacing it with a framework/auth migration.

**Alternatives considered.** Rewriting to Next.js + Supabase Auth/RLS, splitting domain services, or moving the API into serverless functions.

**Trade-offs/risks.** Server-side team policies are the security boundary; this implementation does not use Supabase Auth or RLS. Hosting API and UI separately adds deployment configuration. Free hosting sleeps or expires data and is only suitable for a review demo.

**How to revisit.** Move to a single Next.js/Supabase deployment only if requirements need Supabase Auth/RLS or server-rendered pages enough to justify a full migration with a data conversion plan.

## 2. Centralize resource authorization in the API

**Context.** Users have different roles across teams, and guessing an item ID must not grant access.

**Decision.** Resolve the caller's membership from the target item's team on each API route, then use `authz/policies.ts` for read/create/comment/claim/edit/assign/transition decisions. The browser only hides unavailable controls as a usability aid.

**Alternatives considered.** UI-only checks, a global role, or a Supabase RLS-backed browser database client.

**Trade-offs/risks.** The database is reachable only from the API/worker and its credentials stay server-side, but policies are not independently enforced by RLS. Every new route must call the shared access/policy helpers.

**How to revisit.** If clients or services receive direct database access, introduce database roles and row-level policies before exposing those credentials.

## 3. Use atomic claim and optimistic versions

**Context.** Two people can claim an unassigned item, or edit a stale copy.

**Decision.** Claim uses one conditional update requiring `assignee_id IS NULL`, `status = open`, and the expected version. Other edits compare `expectedVersion` and increment `version` in the same update. Conflicts return `409` and the latest serialized item.

**Alternatives considered.** Read-then-write claims, last-write-wins, or holding a database lock while a user edits.

**Trade-offs/risks.** Users must refresh and reapply edits after a version conflict. The database write remains short and no lock is held during a human editing session.

**How to revisit.** Add field-level merge assistance if real usage shows frequent conflicts; retain the server-side conditional update as the correctness boundary.

## 4. Commit audit/idempotency/outbox data with the mutation

**Context.** A retry or process failure must not silently lose history or duplicate a state change.

**Decision.** Work-item mutations, append-only event rows, idempotency response rows, and outbox rows share a Prisma transaction. A worker claims events with `FOR UPDATE SKIP LOCKED`, retries with exponential delay, and writes a notification row unique by outbox-event ID.

**Alternatives considered.** Logging history after the update, sending notifications inline, or adding Redis/Kafka.

**Trade-offs/risks.** The event log is append-only via a PostgreSQL trigger. The notification handler is currently a database simulation, not email/push delivery. The free demo can co-host API and worker; when that service sleeps, secondary processing pauses.

**How to revisit.** Split the worker into a separately monitored always-on service when operating on a paid plan or when notification delay becomes important.

## 5. Bound list/history queries and index the access paths

**Context.** The challenge expects tens of thousands of items and a growing history without loading all rows into a browser.

**Decision.** Work lists use team-scoped server-side filtering, trigram-backed substring search, stable `(updated_at, id)` cursor ordering, a fixed snapshot, and a 100-row maximum. Item history is independently cursor-paginated. Composite and lookup indexes match the query paths.

**Alternatives considered.** Fetch all data and filter in React, offset pagination, or a dedicated search service.

**Trade-offs/risks.** Substring search is less expressive than a relevance-ranked full-text engine. Dashboard aggregates and additional filters can be added as usage patterns become clear.

**How to revisit.** Measure query plans on representative data, then add partial/composite indexes or a search index only where measurements justify them.
