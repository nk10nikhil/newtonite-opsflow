# Known limitations

## Intentional assessment-scope omissions

- Accounts are provisioned through the optional demo seed. There is no public sign-up, password reset, MFA, SSO, team creation, invitation, or membership-management flow.
- The current item model has no due date, soft archive, human-readable key, approval graph, or SLA/escalation engine. The supported workflow is `open`, `in_progress`, `blocked`, `resolved`, and `closed`.
- The dashboard provides saved views and paginated filtering, but not server-computed KPI tiles for overdue/active totals. List filtering does not yet include type or creator.
- Outbox notifications are generic database rows with structured worker logs. There is no recipient inbox, email, push, chat, or real-time subscription.
- The browser tests cover login and conflict UI components; there is no Playwright end-to-end suite.

These omissions are outside the original six-page challenge's minimum usable scope. They are not presented as implemented features.

## Operational limitations

- Authorization is enforced in the Fastify API. The application does not use Supabase Auth or PostgreSQL RLS; PostgreSQL connection credentials are only used by the server-side API and worker.
- The Render free web instance sleeps when idle. The demo's combined API/worker start command pauses outbox processing while asleep. Render free PostgreSQL expires 30 days after creation; use a database with suitable retention for a longer review window.
- Vercel Hobby is appropriate only for personal, non-commercial review use. An actual company-operated deployment needs a provider plan permitted for commercial use.
- There is no multi-process supervision/metrics dashboard, formal data retention/export flow, or backup/restore runbook.
- The full PostgreSQL integration suite requires an available disposable database. In CI it runs against a temporary PostgreSQL service; it must not be directed at production.
