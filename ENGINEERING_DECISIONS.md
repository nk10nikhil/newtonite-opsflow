# Engineering decisions

1. **Modular monolith with PostgreSQL.** The API, worker, and browser client are separate workspace packages, while product logic stays in one API process and one relational database. This keeps delivery and local setup small, and lets work-item updates, audit events, idempotency records, and outbox rows commit together. The trade-off is that modules share one deployment boundary.

2. **Optimistic concurrency for edits.** Work items carry an integer `version`; update statements include the caller's expected version and increment it. A mismatch returns `409 CONFLICT_VERSION` with the latest item. This avoids holding locks while a person edits. The client must load the latest version, review the changed fields, and re-apply its change. Claiming is the exception: it uses one conditional update on `assignee_id IS NULL`, `status = open`, and the expected version.

3. **Centralized, resource-level authorization.** Each item request resolves the caller's membership in that item's team, then applies role and ownership policy functions. The UI hides actions it knows are unavailable, but the API remains authoritative. This prevents a forged team or item ID from granting access and gives policy tests a direct boundary.

4. **Append-only event history.** Comments are user-authored conversation; events record system facts such as creation, assignment, priority changes, status changes, and comment creation. Events are written in the same transaction as their mutation and protected from update/delete by a PostgreSQL trigger. The separate event stream makes handoffs and decisions auditable without treating comments as a state log.

5. **Transactional outbox for secondary work.** State changes insert outbox events in the same transaction as the work-item update, so a rollback cannot leave a notification for a change that never committed. A worker claims rows with `FOR UPDATE SKIP LOCKED`, applies bounded exponential backoff, and records a unique notification keyed by outbox event ID. Handlers must remain idempotent because a worker may retry after a crash.

6. **Explicit scope cuts.** Search uses PostgreSQL trigram indexes and substring matching instead of a dedicated search service. Notifications are persisted as simulated notification rows rather than sent externally. There is no SSO, real-time push channel, SLA/escalation engine, or multi-process worker orchestration. These choices keep the first version runnable locally and preserve the consistency properties that matter most for ownership and history.
