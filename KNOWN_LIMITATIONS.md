# Known limitations

- Notifications are simulated as database rows and structured worker logs; there is no email, push, or chat delivery.
- The web client refreshes after mutations and has no WebSocket or server-sent event channel for real-time updates.
- There is no SLA timer, escalation policy, approval graph, or scheduled-work engine.
- Authentication uses seeded database users and opaque session cookies; there is no SSO, MFA, password reset, or self-service account management.
- Integration coverage focuses on the concurrency, idempotency, authorization, workflow, outbox, and pagination risks. The browser has a small component test set and no broad end-to-end suite.
- The outbox worker is one process in the documented local setup. PostgreSQL row locking allows multiple workers, but deployment health checks, worker supervision, and operational metrics are not included.
- Event history is append-only and intentionally has no retention or archival job. The sample application has no data export or administrative deletion workflow.
