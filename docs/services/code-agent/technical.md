# Code Agent Technical Reference

Code Agent orchestrates autonomous code execution tasks. It accepts task submissions from the web UI, Intex Agent, trusted internal services, GitHub PR comments, and Linear assignment automation. It sanitizes prompts, deduplicates tasks, dispatches signed worker requests, streams logs, processes completion webhooks, manages PR automation, syncs Linear state, and records task lifecycle events.

## Architecture

```mermaid
flowchart LR
    Web[Web UI] --> Code[code-agent]
    Intex[intex-agent] --> Code
    GitHub[GitHub Webhooks] --> Code
    Linear[linear-agent] --> Code
    Code --> Store[(Firestore)]
    Code --> Orch[orchestrator]
    Orch --> Worker[code-worker]
    Code --> Linear
```

## Current Internal Entry Points

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/internal/monitoring/status` | Read aggregate scheduled-job execution records and Firestore monitoring diagnostics; internal token required |
| `POST` | `/internal/code/submit` | Create a code task from Intex Agent or another trusted service |
| `POST` | `/internal/code/submit-phase2` | Submit Phase 2 implementation from an approved planning task |
| `PATCH` | `/internal/code-tasks/:taskId` | Receive worker status callbacks for a code task |
| `PATCH` | `/internal/code-tasks/:id/status` | Commit terminal task status through the redundant status endpoint |
| `GET` | `/internal/code-tasks/zombies` | List zombie tasks for diagnostics |
| `POST` | `/internal/code/detect-zombies` | Detect and interrupt zombie tasks from scheduler automation |
| `POST` | `/internal/code/cancel-with-nonce` | Cancel a task through a signed WhatsApp nonce |
| `GET` | `/internal/code-tasks/linear/:linearIssueId/active` | Check whether a Linear issue has an active blocking task |
| `POST` | `/internal/code/heartbeat` | Process orchestrator heartbeats |
| `POST` | `/internal/code/group-summary/recompute` | Recompute issue group summaries after Linear label changes |
| `POST` | `/internal/code/pubsub/pr-triage` | Receive Pub/Sub-triggered PR triage events |
| `GET` | `/internal/linear/issue-context/:identifier` | Fetch Linear issue context for orchestrator diagnostics |
| `POST` | `/internal/drain-queue` | Drain queued code tasks |
| `GET` | `/internal/tasks/:taskId/dispatch-metadata` | Fetch dispatch metadata for internal task diagnostics |
| `POST` | `/internal/webhooks/task-complete` | Receive task completion callbacks from orchestrator |
| `POST` | `/internal/webhooks/task-event` | Receive worker task events |
| `POST` | `/internal/webhooks/compliance-report` | Receive orchestrator compliance reports |
| `POST` | `/internal/webhooks/usage-events` | Forward orchestrator usage events to LLM usage service |
| `POST` | `/internal/logs` | Receive log chunks from orchestrator |
| `POST` | `/internal/turn-metrics` | Receive turn metrics from orchestrator |
| `POST` | `/internal/merge-queue/tick` | Run the merge queue scheduler tick |
| `POST` | `/internal/merge-conflicts/reconcile` | Reconcile merge-conflict state from scheduler automation |
| `POST` | `/internal/execution-memory/process` | Process execution memory backlog entries |
| `POST` | `/internal/execution-memory/sweep-errored` | Requeue permanently errored execution memory applications |
| `POST` | `/internal/execution-memory/prune-stale` | Prune aged zero-application execution memories |
| `POST` | `/internal/archive-stale-groups` | Archive stale task groups from scheduler automation |
| `POST` | `/internal/auto-archive-merged-tasks` | Archive merged tasks from scheduler automation |

`POST /internal/code/submit` uses internal auth, accepts `userId`, `prompt`, optional `workerType`, optional `taskMode`, and optional `linearIssueId`, then delegates to the same direct task submission use case as user-facing code task creation.

## GitHub Review Routing

GitHub Agent review triage supports `code_quality`, `security`, `architecture`, `test_quality`, and `documentation` review scopes. Plan-only PRs still route to `plan_review` through deterministic file matching. Docs-only non-plan PRs now route deterministically to a `documentation` review without LLM triage; mixed documentation and code changes continue through GitHub Agent triage so multiple review scopes can be requested when appropriate.

## Scheduled-Job Monitoring

`GET /internal/monitoring/status` requires `x-internal-auth`; scheduler OIDC alone does not authorize this status read. It returns the standard success envelope with `data.schemaVersion: 1`, `data.observedAt` (ISO timestamp), `data.jobs`, and `data.firestoreMonitoring` (aggregate cache/listener diagnostics). Invalid internal authentication returns `UNAUTHORIZED`; an unavailable heartbeat store returns `SERVICE_UNAVAILABLE`.

Each job record contains `key`, nullable ISO timestamps `lastStartedAt`, `lastFinishedAt`, `lastSucceededAt`, and `lastOutcome: 'never' | 'running' | 'succeeded' | 'failed'`. The fixed inventory is:

| Scheduled POST route | Job key |
| --- | --- |
| `/internal/drain-queue` | `drain_task_queue` |
| `/internal/merge-conflicts/reconcile` | `merge_conflict_reconcile` |
| `/internal/merge-queue/tick` | `merge_queue_tick` |
| `/internal/code/detect-zombies` | `code_tasks_zombie_sweep` |
| `/internal/archive-stale-groups` | `archive_stale_groups` |
| `/internal/auto-archive-merged-tasks` | `auto_archive_merged_tasks` |
| `/internal/execution-memory/process` | `execution_memory_process` |
| `/internal/execution-memory/sweep-errored` | `execution_memory_sweep_errored` |
| `/internal/execution-memory/prune-stale` | `execution_memory_prune_stale` |

Hooks start execution records only after scheduler authentication: a Google OIDC token verified for `INTEXURAOS_SERVICE_URL`, or the internal token. Completion records HTTP errors and logical failures in response bodies as failed; successful empty ticks still produce execution evidence. These timestamps describe job execution, not final notification delivery.

The owned store is `code_job_heartbeats`. With `INTEXURAOS_ENVIRONMENT=prod` and `INTEXURAOS_MONITORING_STATE_DIR` set, the shared store uses durable local records after a bounded initial Firestore seed; otherwise status reads use per-job Firestore snapshot caches. This avoids polling job history for each status read and fails on unavailable persistence/watch state rather than inventing success.

Source: `apps/code-agent/src/routes/jobMonitoring.ts:7-88`; `apps/code-agent/src/routes/helpers/internalAuth.ts:39-69`; `apps/code-agent/src/services.ts:171`; `packages/common-core/src/monitoring.ts:2-8`; `packages/infra-firestore/src/jobHeartbeat.ts:43-66,107-134`; `packages/infra-firestore/src/snapshotCache.ts:24-38,62-72`.

## Profile-Controlled PR Triage

`INTEXURAOS_PR_TRIAGE_ENABLED` enables PR triage only when its value is `true` (case-insensitive); it defaults to true. The Home PROD basic profile forces false; full uses the configured value or true by default. Disabling it skips PR-triage publication/inline fallback and push-triggered conflict detection, while preserving GitHub event persistence and recording the `stage1_unavailable` decision. This is a profile capability gate, not removal of GitHub webhook ingestion.

Source: `apps/code-agent/src/config.ts:72-73`; `ecosystem.config.prod.cjs:440-441`; `apps/code-agent/src/domain/usecases/processGitHubWebhook.ts:725-755,799-804`.

## Current Code Reliability Changes

- **Callback signatures:** completion callbacks verify the original JSON request bytes captured before schema coercion, using HMAC-SHA256 over `timestamp.rawBody` and the task webhook secret. Re-serialized JSON is a fallback only when captured bytes are unavailable.
- **Terminal notifications:** retry-budget exhaustion publishes the exhaustion notice once. If that publish succeeds, completion skips the generic failure notice; if it fails, the generic notice is attempted. This is publish coordination, not proof of final WhatsApp delivery. Handled retry warnings remain logged without Sentry capture.
- **Failure evidence:** `SENTRY_EVIDENCE_UNAVAILABLE` is terminal even when a retry action is attached. Linear validation failures already reported by the owning service use informational downstream logs; recognized `UNAVAILABLE` failures retain the existing fallback paths. Expected missing notification-title issue lookups return no title without creating another error report.

## Changes Since v3.8.0

- **Error remediation:** `POST /webhooks/sentry` verifies SentryBox signatures and accepts supported issue/event alerts. `processSentryWebhook` uses durable leased reservations; repeated correlated errors and active remediation work reuse existing tasks. Retryable reservation failures remain retryable.
- **Dispatch ownership:** queue dispatch claims a per-user lease and task attempt before contacting the worker. Attempt/owner checks prevent stale acknowledgments or rollbacks from overwriting newer ownership. Review reservations and PR locks coordinate competing review requests; queued non-review work runs before review.
- **Lifecycle evidence:** `statusChangedAt` records status transitions separately from ordinary updates; `taskLifecycleTime.ts` resolves legacy timestamps. Merge-ready evidence and invalidation decisions persist with task-group summaries rather than depending only on the latest task.
- **Planning and messages:** planning uses one artifact and one evidence PR; `sendTaskMessage` accepts planning tasks but still rejects ephemeral review/remediation tasks. `startAskAgent` selects `workerType: codex`.
- **Provider routing:** platform LLM clients use OpenRouter through the shared factory. Expected recovery/validation warnings remain in logs without duplicate error alerts.

## Removed Compatibility Behavior

- No action status mirror service.
- No action-status callback client.
- No action approval fields on new task records.
- No public or internal command/action compatibility routes.

## Verification Notes

Task completion, cancellation, interruption, and failure should update code-task state and Linear state only. Tests should assert no removed callback route is invoked even when old stored task records contain legacy metadata.
