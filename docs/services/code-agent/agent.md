# Code Agent Reference

Code Agent owns autonomous code task creation, task lifecycle state, GitHub automation, Linear synchronization, worker dispatch, and task logs.

## Supported Task Submission

- Public web/API task creation routes.
- Internal direct task creation from Intex Agent and other trusted services through `POST /internal/code/submit`.
- GitHub PR comments and webhook-driven follow-up tasks.
- Linear assignment-triggered task creation.

The retired action-status callback path is gone. Code Agent no longer mirrors task state to a separate action resource.

## Release Integration Boundaries

- SentryBox alerts enter through `POST /webhooks/sentry` with signature validation and durable deduplication. Reuse the returned task relationship when remediation is already active.
- Dispatch and review ownership are durable: do not bypass queue claims, attempt fencing, or PR review reservations.
- Ask Agent selects `codex`. Messages can resume planning tasks; review and remediation task types reject interactive messages.
- Treat persisted lifecycle and merge-ready evidence as the source for task-group state.

## Read Scheduled-Job Execution Evidence

Use `GET /internal/monitoring/status` with `x-internal-auth` (not scheduler OIDC alone). Read `data.schemaVersion` (`1`), `data.observedAt`, `data.jobs`, and aggregate `data.firestoreMonitoring`. `UNAUTHORIZED` rejects invalid auth; `SERVICE_UNAVAILABLE` means the heartbeat store is unavailable. Jobs contain `key`, nullable `lastStartedAt`/`lastFinishedAt`/`lastSucceededAt`, and `lastOutcome` (`never`, `running`, `succeeded`, `failed`). The fixed nine-job route/key inventory is in [the technical reference](technical.md#scheduled-job-monitoring).

Use execution timestamps to distinguish never-run, running, failed, and succeeded scheduler work. A successful empty tick is still execution evidence; it is not a WhatsApp delivery receipt. Home PROD can use durable local heartbeats; the Firestore-backed path uses change-driven per-job snapshot caches rather than repeated history scans.

Source: `apps/code-agent/src/routes/jobMonitoring.ts:7-58`; `packages/infra-firestore/src/jobHeartbeat.ts:43-66,107-134`.

## Key Boundaries

- Code tasks default to planning mode unless execution mode is explicitly requested.
- Design review before implementation remains a quality gate.
- Documentation-only non-plan PRs request `documentation` review; plan-only PRs request `plan_review`.
- Worker dispatch stays HMAC-signed and container isolated. Completion callbacks verify the captured original JSON bytes, before schema coercion.
- Treat `SENTRY_EVIDENCE_UNAVAILABLE` as terminal; inspect the concrete missing evidence before requesting another investigation.
- Retry exhaustion owns the terminal notification when its publish succeeds; the generic failure notification is a publish-failure fallback.
- Internal endpoints must call `logIncomingRequest()` before auth validation.
