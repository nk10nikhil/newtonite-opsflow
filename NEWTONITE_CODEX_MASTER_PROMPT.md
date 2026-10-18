# Master Prompt for Codex: Build Newtonite OpsDesk End-to-End

> **How to use:** Open the project repository in VS Code, attach `Newtonite_Software_Engineering_Challenge.pdf` in Codex if it is not already available in the workspace, then paste the full prompt below. Let Codex work directly in the repository. Review the resulting architecture and decisions yourself before submitting.

---

## ROLE AND EXECUTION CONTRACT

Act as a senior full-stack engineer, product-minded technical lead, security reviewer, test engineer, and deployment engineer. Build a coherent, polished, working solution to the **Newtonite Software Engineering Challenge — Operations Under Pressure** in the currently open repository.

This is an assessed engineering submission. Quality of reasoning, reliable behavior, clear trade-offs, maintainability, and the ability to explain the solution matter more than a large number of superficial features.

### Mandatory execution rules

1. **Read the attached PDF first.** Read every page of `Newtonite_Software_Engineering_Challenge.pdf` (or the same PDF if its filename/path differs). Treat it as the primary requirements source. Extract the requirements into a checklist before coding. Preserve the brief's terminology and intent; do not silently replace requirements with generic dashboard features.
2. **Inspect before changing anything.** Inspect the existing repository, package manager, code, Git status, and existing work. If the repository already contains a scaffold or partial implementation, preserve and improve it. Do not blindly overwrite working code, delete user files, reset Git, or rewrite history.
3. **Build, do not just plan.** You may state a short plan first, but then implement the application, database migrations, tests, documentation, and deployment configuration in this same work session. Do not stop after a plan, architecture proposal, mockup, or scaffold.
4. **Make sensible decisions without waiting for clarification.** Where the PDF leaves details open, choose a small, defensible solution, record the assumption and trade-off in `ENGINEERING_DECISIONS.md`, and continue. Ask a question only if a genuine blocker makes implementation impossible.
5. **Prefer a smaller complete system over a broad incomplete one.** Avoid speculative microservices, paid APIs, unnecessary queues, or decorative complexity. Every included feature must work end-to-end.
6. **Verify your work.** Run formatting/linting, TypeScript checks, unit tests, relevant integration tests, and a production build. Fix issues and rerun the relevant checks. Do not report a check as passing unless you actually ran it. If a check cannot run due to missing credentials or external infrastructure, state the exact reason and provide a reproducible command for running it.
7. **No fake functionality.** Do not use hardcoded arrays as the production data layer, fake API responses, a local-storage-only database, nonfunctional buttons, TODO-driven core flows, placeholder pages presented as complete, or a simulated success message after a failed request. Demo seed data is allowed only as optional setup data for the real database.
8. **Do not expose secrets.** Never commit credentials, service-role keys, access tokens, or real personal data. Use `.env.example` with placeholders and validate environment configuration safely.
9. **Finish with a concise handoff.** Report implemented features, architecture, tests actually run and their results, files created, deployment steps, any unavoidable limitations, and anything that still needs credentials or manual dashboard setup.

## 1. PRODUCT AND REQUIREMENTS

Build **OpsDesk**, a responsive internal operations-work management application. If the repository already uses a different project name consistently, preserve that identity rather than renaming files gratuitously.

The product replaces fragmented operational requests living in chat, spreadsheets, email, and conversations. It must let employees create, investigate, assign, prioritize, discuss, track, and resolve work while retaining an understandable history of important decisions.

A work item can represent a customer issue, engineering problem, payment investigation, production incident, compliance request, approval, or general operational task.

### The PDF's explicit requirements must be met

- Users can create and manage operational work items.
- A user can understand what an item is and why it exists, its current state and importance, who is responsible, what happened previously, and what needs attention next.
- Multiple teams exist; one user may belong to multiple teams and have different team responsibilities.
- Authorization is meaningful and **enforced by the backend/database**, not only by hiding UI controls.
- Responsibility, priority, and workflow changes are visible in a history/timeline. Important actions must not disappear silently.
- Deliberately handle concurrent use: competing claims/assignments, stale information, rapid updates, and repeated submissions.
- The overview should surface urgent, overdue, unassigned, and personally assigned work. Search and filters must help users find relevant work quickly.
- Do not load the complete work-item dataset into the browser. Use server-side filtering, indexed queries, and pagination.
- Demonstrate at least **three** correctness cases that go beyond basic CRUD. Implement the four core cases in this prompt where feasible: atomic work claiming, stale-write detection, valid workflow transitions, and resource-level authorization. Idempotent repeated submissions are also required for at least one important create/action endpoint.
- Include automated tests for risky behavior, not merely snapshots or trivial render tests.
- Include `ENGINEERING_DECISIONS.md` covering approximately five material decisions and trade-offs.
- Include clear local setup instructions, a brief known-limitations document, and architecture documentation/diagram where useful.
- Make the solution straightforward to demonstrate and deploy using **free tiers only**; do not require a paid API or service.

## 2. TECHNICAL DIRECTION

Use a straightforward, modern TypeScript stack with a single primary deployable application:

- **Application:** Next.js App Router with TypeScript strict mode.
- **UI:** React, Tailwind CSS, and a consistent accessible component system such as shadcn/ui where appropriate; Lucide icons are fine. Use React Server Components for data-heavy pages where sensible and client components only where interaction is needed.
- **Validation:** Zod for untrusted form input and API payloads.
- **Forms:** React Hook Form only where it simplifies complex forms; keep simple forms simple.
- **Backend/API:** Next.js Route Handlers (or an equally clear server-side pattern supported by the existing repository). Keep database access in a dedicated server-side data layer, not scattered across components.
- **Database and authentication:** Supabase Auth + PostgreSQL, using `@supabase/ssr` for cookie-aware server clients. Use SQL migrations, Postgres constraints, indexes, Row Level Security (RLS), and narrowly scoped database functions/triggers for critical invariants.
- **Testing:** Vitest for unit tests, plus integration/SQL tests and a small Playwright end-to-end smoke suite where the environment permits.
- **Package manager:** Keep the repository's existing package manager. If none exists, use npm and commit the appropriate lockfile.
- **Deployment:** Vercel Hobby for the Next.js app and Supabase Free for Auth/PostgreSQL. No required paid service, credit-card-dependent add-on, external AI API, or paid email provider.

Use currently supported stable package versions compatible with each other. Avoid unnecessary dependencies. Keep application and database types aligned; generate or maintain typed database definitions instead of using `any` broadly.

### Important database/security design requirements

- Use the Supabase **publishable/anon key only where designed to be public**. A service-role/secret key must never use a `NEXT_PUBLIC_` prefix and must never reach browser code.
- Create one canonical server-side Supabase client helper and one browser client helper, with clearly separated responsibilities.
- All server mutations must validate the authenticated user and payload. Database RLS/policies and database-side logic must remain the final security boundary.
- Use RLS on every table containing user, team, work-item, comment, invite, notification, or audit data. Default to denial; grant only the access required.
- Carefully lock down `SECURITY DEFINER` database functions if used: fixed safe `search_path`, explicit role/resource checks based on `auth.uid()`, limited `EXECUTE` grants, and no trust in a caller-supplied user ID. Prefer invoker-security functions when that is sufficient.
- Use real foreign keys, check constraints, unique constraints, not-null constraints, and appropriate cascade/restrict behavior. Do not rely solely on frontend validation.
- Make important changes and their activity/audit records atomic in one database transaction, preferably with database triggers or transactional RPC functions.
- Audit history should be append-only for normal application roles; users must not be able to rewrite or delete past audit events.
- Never return server secrets, stack traces, SQL details, or internal auth information to the client. Return useful, consistent, typed errors.

If the existing scaffold already uses a different suitable stack, do not start a disruptive rewrite automatically. First assess whether it can satisfy the above reliability/security requirements; preserve it when it can.

## 3. DATA MODEL AND PERMISSIONS

Design a normalized PostgreSQL schema and document it. At minimum, model:

1. `profiles`: app-facing user profile tied to Supabase Auth; safe display name/avatar fields only.
2. `teams`: team name, slug or stable identifier, description, creator, timestamps.
3. `team_memberships`: team/user membership with a team-specific role; enforce uniqueness of `(team_id, user_id)`.
4. `work_items`: team, title, description/context, work type, status, priority, creator/reporter, optional assignee, optional due date, created/updated timestamps, archive state, and a monotonically increasing `version` for optimistic concurrency.
5. `comments`: work-item discussion, author, body, timestamps; comments visible only to authorized team members and not silently mutable/deletable.
6. `activity_events` (or equivalently named append-only audit table): actor, team/work-item, action, meaningful before/after or structured change data, timestamp. Record creation, important field changes, claim/assignment, status transition, comment, and archive/reopen actions.
7. `notifications`: in-app notifications for important actions such as assignment or a relevant update; read/unread state. Avoid external email/SMS dependency.
8. `idempotency_records` (or a carefully designed equivalent): ensure retries for at least one important mutation, such as work-item creation, cannot create duplicates.
9. `team_invites` or an equally usable membership-onboarding flow so a team manager can add a real second user without direct database editing. Make invites expiring and single-use; store a hash of a token rather than its raw value where practical.

You may adapt names/schema to fit an existing implementation, but preserve the capabilities and integrity constraints above. Supply ordered SQL migrations and optional, safe demo seed tooling. Migrations must be repeatable in the documented workflow and must not destroy existing user data.

### Roles and intended permissions

Use clear team-scoped roles, for example:

- **Owner:** full control of their team, memberships, invitations, and team settings.
- **Manager:** manage team membership/invites where appropriate, assign work, change priority and workflow, archive/reopen items, and view team work.
- **Member:** create work, comment, claim eligible unassigned work, edit normal work-item fields, and perform allowed workflow transitions.
- **Viewer:** read-only access to the team's work and history.

A user may have a different role in each team. A user must not gain access merely by guessing a UUID. Team membership alone does not grant update rights if that user's team role is read-only. Assignment targets must be valid members of the same team. Enforce authorization at the database/API layer, and test cross-team access explicitly.

Document the permission matrix in the README or architecture docs. Hide or disable unavailable actions in the UI as a usability measure, but never treat that as security.

### Work-item domain rules

- Types should cover the examples from the brief: customer issue, engineering, payment investigation, production incident, compliance, and general operations. Use a validated enum or lookup model with human-friendly labels.
- Priorities: `low`, `medium`, `high`, `urgent`.
- Statuses: a small, explicit lifecycle such as `open`, `in_progress`, `blocked`, `in_review`, `resolved`.
- Define and enforce legal status transitions in one authoritative domain/database location; do not duplicate inconsistent rules in multiple UI components.
- Reopening a resolved item should require elevated team permission. A normal member must not bypass the workflow using a direct API request.
- Archiving should normally be a soft archive restricted to managers/owners. Never silently hard-delete historical work.
- Generate a stable, human-readable identifier for each work item if it fits the existing design without complicating correctness.
- Validate title length, description length, dates, allowed enum values, and comment length on both API and database sides where appropriate.
- Reject assignments to a user who is not an eligible member of that item's team.
- Treat UTC timestamps consistently; format them in the user's locale in the UI.

## 4. NON-CRUD CORRECTNESS CASES — ACCEPTANCE CRITERIA

Implement and test these behavior classes. A UI-only workaround does not count.

### A. Two people try to claim the same unassigned item

Implement an atomic, server/database-enforced claim operation. A claim must succeed only if the item is still unassigned (and the caller has permission). If two users race, exactly one may win; the other gets a clear conflict response and the current assignment is refreshed/shown. Do not implement this as “read then write” without an atomic condition/transaction. Audit the winning claim once.

### B. One user saves an item after another user has changed it

Use the `version` field or an equally sound optimistic concurrency strategy. Mutations must include the expected version. The database update must compare the expected version atomically and increment it on success. A stale mutation returns HTTP `409 Conflict` (or a clear equivalent) without overwriting the newer value. The UI must explain that the item changed and offer refresh/reload; preserve the user's unsaved draft when reasonable. Do not silently last-write-wins.

### C. Invalid workflow transitions and role restrictions

Centralize the allowed transition graph and enforce it server-side/database-side. Test legal and illegal transitions and verify that Viewer/Member/Manager permissions differ as documented. A forged API request must not bypass these rules.

### D. Resource-level authorization

Use two test users from different teams. Verify one cannot fetch, search, modify, comment on, archive, or infer confidential details about the other's items. Test Viewer write attempts and manager-only operations too. Use RLS and server checks as appropriate; UI visibility tests alone are insufficient.

### E. Idempotent retries

For at least one meaningful mutation, accept an idempotency key or equivalent unique operation identifier. Retrying the same key and same payload must return the original result without duplicate work item/comment/activity/notification side effects. Reusing that key with a different payload must return a conflict. Enforce this with database uniqueness/transaction behavior, not an in-memory map.

### F. Repeat submission and partial failure

Disable repeat submit in the UI while a request is in flight, but also make the server correct when a client retries or sends duplicate requests. Save the primary mutation and its audit record transactionally. If optional secondary work is introduced, explain retry/failure handling and avoid claiming success for work that failed. Do not add a background queue unless it solves a real need and can be operated reliably on the selected free tier.

## 5. CORE USER EXPERIENCE

Create an intentionally designed, professional internal SaaS interface suitable for an engineering assessment. Optimize for clarity and speed, not decoration. Do not copy another product's branding. Use an accessible, consistent design system with coherent spacing, typography, color, focus states, and responsive layouts.

### Required pages/flows

1. **Authentication:** sign in, sign up, sign out, session persistence, friendly validation/error states, and correct post-login redirect. Protect authenticated pages on the server. No demo credential bypass.
2. **First-use onboarding:** a new authenticated user with no teams can create a team or accept a valid invitation. Explain what to do instead of showing an empty broken dashboard.
3. **Dashboard / overview:** meaningful KPI summaries for active work, assigned to me, urgent, overdue, and unassigned items; a useful “needs attention” section; recent activity; quick navigation. Compute numbers from authorized, server-filtered database queries, not from an arbitrarily truncated browser array.
4. **Work-item list:** server-side pagination, useful default sorting, search, and combinable filters for team, status, priority, type, assignee, creator, and due/overdue state. Provide clear filter reset, result count where accurate, loading skeletons, empty states, and recoverable error states. Set reasonable maximum page size.
5. **Create work item:** validated form for title, description/context, type, priority, team, optional assignee and due date. Show success only after server confirmation. Avoid duplicate creation after retry.
6. **Work-item detail:** show key information, status/priority, owner/assignee, due date, description, comments, and a chronologically ordered activity timeline. Provide role-appropriate edit, claim, assign, transition, archive/reopen, and comment actions.
7. **Team workspace:** list teams the signed-in user belongs to, team settings where permitted, member/role list, and invitations/membership flow. Do not reveal users or teams the current user is not allowed to see.
8. **Notifications:** a modest in-app inbox/unread indicator for useful events. Mark read safely and scope notifications to the current user. Avoid overbuilding push/email delivery.
9. **Profile/account:** display name and basic account settings needed by the experience.

A Kanban board is optional. Build it only after list, detail, permissions, history, and the main correctness cases are complete. Do not sacrifice core behavior to add drag-and-drop.

### UI quality bar

- Responsive from desktop down to mobile; no horizontal overflow or clipped dialogs.
- Every visible button/menu/row action works and has appropriate disabled/loading feedback.
- Forms have labels, validation messages, keyboard navigation, and accessible focus states.
- Use semantic HTML and accessible contrast; do not rely on color alone for status/priority.
- Support loading, empty, permission-denied, not-found, network failure, and conflict states.
- Confirm destructive or irreversible actions; prefer soft-archive/undo when safe.
- Use optimistic updates only if you can reconcile server failures and stale versions correctly. Otherwise use server-confirmed updates.
- Do not fill the screen with charts that do not inform operational decisions. Keep the dashboard useful and fast.
- Use consistent empty states and realistic seed records that demonstrate urgent, blocked, overdue, unassigned, and resolved items.

## 6. API, VALIDATION, AND PERFORMANCE

- Use a consistent JSON response/error shape and appropriate HTTP codes (`400` invalid payload, `401` unauthenticated, `403` unauthorized, `404` genuinely not found, `409` concurrency/idempotency conflict, `429` if actual rate limiting is implemented, and `5xx` for unexpected server errors).
- Validate all request bodies, query strings, path identifiers, enum values, sort fields, and pagination values with Zod or equivalent. Never build raw SQL from user input.
- Use server-side filtering/search/pagination. Add indexes guided by real queries: team and status/priority/assignee filters, due-date or created/updated ordering, membership lookups, event-by-item time ordering, notification-by-user/read/time, idempotency uniqueness, and text search if provided.
- Avoid N+1 query patterns and fetching the whole activity history by default. Paginate comments/activity for long-lived items.
- Use a Postgres full-text search index or another sensible indexed search approach over useful work-item fields. Document search behavior and limitations.
- Keep list payloads small; select only needed columns. Use bounded result counts and stable ordering (tie-break on a unique key).
- For dashboards, avoid one massive query or loading all work items. Use small aggregate/count queries scoped to the user's team memberships, and measure/inspect query patterns where practical.
- Add sensible caching only for non-sensitive/static content. Do not accidentally cache personalized data across users. Always keep authorization correct despite Next.js caching.
- Add accessible error boundaries/not-found handling and server-side logs that omit secrets and sensitive content.
- Add rate limiting only if a clear free-tier-compatible strategy is available; do not add an unreliable in-memory limiter and describe it as production grade.

## 7. CODEBASE STRUCTURE AND MAINTAINABILITY

Prefer a clear, feature-oriented structure. Adapt to the existing repository if it is already coherent. A reasonable starting point is:

```text
.
├── app/
│   ├── (auth)/                 # sign-in/sign-up
│   ├── (app)/                  # protected application routes
│   │   ├── dashboard/
│   │   ├── work-items/
│   │   ├── teams/
│   │   ├── notifications/
│   │   └── settings/
│   ├── api/                    # route handlers for mutations/query endpoints where needed
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── ui/
│   ├── layout/
│   ├── work-items/
│   ├── teams/
│   └── shared/
├── features/                   # domain-specific UI/data orchestration where useful
├── lib/
│   ├── supabase/               # browser/server/middleware clients
│   ├── auth/
│   ├── validation/
│   ├── errors/
│   └── utils/
├── domain/                     # transition graph, permissions, domain types/rules
├── supabase/
│   ├── migrations/
│   ├── seed.sql                # only if suitable and safe
│   └── tests/                  # SQL/policy tests if using pgTAP
├── scripts/                    # optional safe demo-user/seed script
├── tests/                      # unit, integration, and E2E tests
├── docs/
│   └── architecture.md
├── .github/workflows/ci.yml
├── .env.example
├── README.md
├── ENGINEERING_DECISIONS.md
└── KNOWN_LIMITATIONS.md
```

Avoid giant components, duplicated permission logic, deeply nested ternaries, untyped `any`, inconsistent naming, and abstractions that make a one-day assessment harder to reason about. Create reusable components when they improve consistency, not merely to increase file count. Keep domain rules testable independently of React.

## 8. TEST STRATEGY AND VERIFICATION

Write tests around failure modes that would damage trust in the system. At minimum, implement:

### Unit tests

- Legal/illegal status-transition matrix, including reopen permissions.
- Role/permission matrix.
- Payload validation and error mapping where helpful.
- Idempotency fingerprint/key behavior if part of application code.

### Database/API integration tests

- RLS/resource isolation across two different teams.
- Viewer cannot mutate; member cannot perform manager-only operations.
- Invalid transition rejected by the server/database.
- Stale version update rejected without overwriting the newer data.
- Concurrent claims result in exactly one successful assignee.
- Duplicate request retries create exactly one operation and one set of side effects.
- Audit records are created atomically and cannot be modified/deleted by normal application roles.

Prefer real database-backed tests for race/RLS constraints. If using Supabase CLI/pgTAP, provide the migration/test commands and make tests reproducible against a disposable local/test database. Do not run destructive tests against a production database.

### End-to-end smoke tests

Cover at least the essential path: sign in, see authorized dashboard, create item, open detail, claim/assign or update it, add a comment, and verify history reflects the change. Include permission/error/conflict assertions where they are practical. E2E tests may require configured test credentials; document those variables and ensure regular `npm test` does not unexpectedly depend on a live production service.

### Required commands

Provide working package scripts such as:

- `dev`
- `build`
- `start`
- `lint`
- `typecheck`
- `test`
- `test:watch`
- `test:e2e` (if Playwright is included)
- database migration/test/seed scripts appropriate to the chosen setup

Run all checks that are possible in the current environment. Fix all code/build/test errors you can. If external Supabase credentials are absent, still ensure lint/typecheck/unit tests/production build can run as far as reasonably possible without secrets, and clearly distinguish unit checks from database-backed tests that need a configured database.

## 9. README AND SUBMISSION DOCUMENTATION — HIGH PRIORITY

The README is part of the assessment and should look like a thoughtful engineering handoff, not a generic template. Write it after the actual architecture and commands are known. Never claim a feature, test, screenshot, deployment, performance result, or URL exists unless verified.

### `README.md` must include

1. Project name and a concise, strong description of the operational problem solved.
2. A short feature overview focused on real user outcomes.
3. A clearly marked “Engineering highlights” section naming the correctness cases (atomic claim, optimistic concurrency, workflow enforcement, RLS/resource authorization, idempotency, auditability) **only where actually implemented**.
4. Tech-stack table with concise reasons for each technology.
5. A high-level Mermaid architecture diagram showing browser, Next.js application/API, Supabase Auth/Postgres/RLS, and deployment boundary.
6. A Mermaid ERD or link to a diagram documenting the important tables/relationships.
7. A clean project structure overview that explains key directories.
8. Prerequisites and exact local setup commands, including Node version guidance and package-manager commands.
9. `.env.local` setup, listing every required variable, where to obtain it, which values are public versus secret, and a warning never to expose the Supabase service-role key.
10. Exact database setup/migration instructions; explain whether to use the Supabase dashboard SQL Editor or Supabase CLI and include all required steps in the correct order.
11. Optional demo-data setup with safe demo-user credentials procedure. Never publish a real secret in README. Explain how to seed a fresh development database and reset only a disposable local/test database.
12. Local development, lint, typecheck, test, production build, and E2E commands, with what each command verifies.
13. Step-by-step **free-tier deployment** for Vercel + Supabase: create the project, apply migrations, set environment variables, configure Supabase Auth site URL and redirect URLs, connect the repository, deploy, smoke-test, and verify that secrets are not exposed. Link the relevant official docs, including [Vercel Hobby plan](https://vercel.com/docs/plans/hobby), [Vercel Next.js deployment](https://vercel.com/docs/frameworks/nextjs), [Supabase billing/free plan](https://supabase.com/docs/guides/platform/billing-on-supabase), [Supabase free-project pausing](https://supabase.com/docs/guides/platform/free-project-pausing), and [Supabase server-side Auth for Next.js](https://supabase.com/docs/guides/auth/server-side/nextjs). Verify that URLs and guidance are still current at implementation time.
14. Free-tier caveats: clearly explain applicable hosting/database quotas, inactivity pausing or service sleep if relevant, build/function limits, and the fact that a free portfolio deployment is not a guarantee of production capacity/uptime at the brief's target concurrency. Ask the developer to verify current provider limits before submission because plan limits can change.
15. A testing matrix mapping critical risks to the corresponding test(s) and commands.
16. A short security section describing RLS, team-level permissions, server-only secrets, input validation, and audit log integrity.
17. `ENGINEERING_DECISIONS.md`, `KNOWN_LIMITATIONS.md`, and architecture docs links.
18. Troubleshooting for missing environment variables, auth redirect mismatch, migrations not applied, RLS permission errors, database-pausing/free-tier sleep, and build/test setup issues.
19. Live-demo URL and screenshots only once they actually exist. Until then, use an explicit `Not deployed yet` placeholder or omit the section; never fabricate links or imagery.

### `ENGINEERING_DECISIONS.md`

Document approximately five real decisions. For each, use: **Context → Decision → Alternatives considered → Trade-offs/risks → How to revisit it**. Cover relevant topics such as:

- Why this stack and a single deployable app were chosen for the one-day/free-tier constraint.
- Data model, team membership, RLS, and role enforcement.
- Concurrent claim and optimistic version checking.
- Transactional audit/idempotency strategy and why optional background processing was included or deferred.
- Search/pagination/indexes and expected growth.

Use facts from the implemented solution; do not document intended behavior as completed behavior.

### `KNOWN_LIMITATIONS.md`

Be candid and specific. Separate intentional assessment-scope omissions from bugs. Include actual free-tier trade-offs and the next sensible improvements if given another week. Do not call a broken or untested critical feature a known limitation and leave it unfixed.

### Architecture docs

Add a concise `docs/architecture.md` with Mermaid diagrams as useful, request/data flow for a work-item mutation, security boundaries, error paths, and how concurrency is resolved. Make diagrams render in GitHub Markdown.

## 10. FREE DEPLOYMENT REQUIREMENTS

Target **Vercel Hobby + Supabase Free** for the simplest all-in-one deployment of a Next.js application and hosted Postgres/Auth. Use only free features and standard platform capabilities. Do not require a credit card or paid add-on as a functional prerequisite. If a provider's onboarding or policy has changed, verify it and document the viable free alternative rather than pretending it is free.

- The application must also work locally with setup instructions and an empty, freshly migrated Supabase project.
- Include `.env.example` with placeholders, not working credentials.
- Include a `.gitignore` that excludes `.env*` except `.env.example`, local test artifacts, dependencies, build output, and secret-bearing files.
- Add a GitHub Actions CI workflow for install, lint, typecheck, tests, and production build. It should not need production secrets for checks that can run locally/with mocks.
- Make the Vercel build compatible with the chosen deployment model. Do not make the build depend on a live logged-in user, runtime-only secret query, or seeded production database.
- Include a deployment smoke-test checklist covering signup/sign-in, onboarding/team membership, list/search, create/detail/edit, claim race or conflict behavior, comments/history, and role restrictions.
- Keep external email optional. The core system must function without custom SMTP. Use in-app notifications and invitation links or another free, clearly documented mechanism.
- No paid Redis, external queue, paid monitoring, paid email, paid file storage, or paid search service is necessary. If you add optional integrations, the core app must still work without them.

Do not state that this free deployment can reliably serve hundreds/thousands of concurrent active users. Design the database/API with that growth in mind, but describe free deployment as a **review/demo deployment** whose real limits are determined by current provider quotas, workload, cold starts, and database capacity.

## 11. IMPLEMENTATION SEQUENCE

Follow this sequence while continuing through all phases in the same session:

1. Read the PDF and inspect the repo. Write a checklist of explicit requirements and implementation risks.
2. Identify what exists, what is missing, and the minimum coherent architecture. Preserve suitable existing code.
3. Establish the database schema and migrations first: tables, constraints, indexes, RLS policies, triggers/RPCs, and database tests.
4. Set up authentication/session handling and safe environment configuration.
5. Implement the domain layer and the core server-side query/mutation functions, especially authorization, workflow, versioning, atomic claim, idempotency, and audit history.
6. Build the main UI flows: onboarding, dashboard, work list/search/filter, create/detail/edit, comments/timeline, team/member/invite management, and notifications.
7. Add realistic optional seed/demo setup and scripts.
8. Add unit, database/API integration, and E2E tests. Run them and repair failures.
9. Polish loading/empty/error/conflict/accessibility/mobile states. Inspect the actual UI in a browser if browser tooling is available; fix obvious layout/console/runtime issues.
10. Complete README, `ENGINEERING_DECISIONS.md`, `KNOWN_LIMITATIONS.md`, architecture docs, `.env.example`, CI, and deployment steps based on the actual code.
11. Run final checks: install/lockfile consistency, lint, typecheck, tests, build, migration/test commands as possible, `git diff --check`, and a quick scan for secrets, nonfunctional buttons, TODOs in critical paths, and fake production data.
12. Provide a final handoff report with exact commands/results and any external actions I must perform. Do not make a Git commit unless I ask.

If time or context becomes constrained, prioritize in this order: secure, correct core data model; authentication and authorization; CRUD/workflow with concurrency and audit correctness; tests for these behaviors; readable UI; deployment; then optional enhancements. Do not skip testing/documentation in favor of extra UI features.

## 12. DEFINITION OF DONE

The project is done only when these statements are true or a specific environment blocker is clearly documented:

- [ ] The attached challenge brief was read and its requirements mapped to the implementation.
- [ ] The app starts locally from the documented commands and has a useful first-run experience.
- [ ] Authentication and session protection work with Supabase.
- [ ] New users can create a team or join through a valid invitation.
- [ ] Work items can be created, listed, searched, filtered, paginated, viewed, edited, assigned/claimed, commented on, transitioned, and archived/reopened according to permissions.
- [ ] Dashboard metrics and work lists are scoped to authorized teams and queried server-side.
- [ ] RLS/resource authorization is implemented and tests cover cross-team denial.
- [ ] Atomic claim contention, stale-write conflicts, illegal transitions/role limits, and idempotent retry are implemented at the backend/database boundary and have meaningful tests.
- [ ] Significant activity appears in append-only history and is transactionally consistent with core changes.
- [ ] Duplicate submissions, loading failures, empty results, missing environment setup, and stale data have understandable behavior.
- [ ] The UI is responsive and accessible enough for a professional demo; no core controls are dead.
- [ ] Unit tests pass; database/E2E results and prerequisites are accurately reported.
- [ ] Lint, typecheck, and production build pass, except for explicitly explained external blockers.
- [ ] `README.md`, `.env.example`, `ENGINEERING_DECISIONS.md`, `KNOWN_LIMITATIONS.md`, architecture docs, migrations, and CI are present and correct.
- [ ] The free deployment steps are specific enough to follow without guessing and do not require paid services.
- [ ] No secrets are committed, no fake claims are made in documentation, and no core workflow is left as a TODO.

**Begin now by reading the PDF and inspecting the repository. Then implement the full solution, verify it, document it, and finish with the handoff report. Do not return only a plan.**
