# Current Dispatch Blockers Design

**Status:** Approved (variant 1)

## Problem

The Dispatch Queue currently presents durable aggregate status documents as if they describe the live queue. Terminal dispatch blockers, such as intentionally unavailable Codex authentication, are recorded before their affected tasks are moved to `failed`. The aggregate status then remains `active` until a later successful dispatch for the same worker type. Its task count is a snapshot, and a recurrence reuses the original `firstSeenAt` timestamp.

This creates the contradictory state shown in the reported screenshot: the queue is empty while banners still say that tasks are blocked. The same expected domain outcome is also logged as a Sentry warning/error, producing duplicate events without an operational action that the system can take.

## Product Semantics

`Dispatch Queue` shows only current blockers:

- An aggregate banner exists only while at least one affected task remains in `queued` state and will be retried automatically.
- A terminal blocker never appears as an active queue banner after its task becomes `failed`.
- The failed task retains the permanent record: reason, remediation, worker diagnostics, first occurrence, last occurrence, and terminal cause.
- Missing Codex or Claude authentication is a valid worker capability state. It is actionable for the user when they requested an incompatible worker type, but it is not by itself a system exception.
- The application does not install authentication, change the default worker type, or weaken dispatch capability checks.

## Backend Lifecycle

`CodeTaskDispatchStatusService` is the single policy boundary for aggregate status persistence:

1. Recoverable blockers (`workers_at_capacity`, `workers_unreachable`) are persisted as active aggregates because their tasks remain queued.
2. Terminal blockers (`codex_auth_unavailable`, `claude_auth_unavailable`, missing provider auth, unhealthy Docker/disk, unknown worker type, incompatible health contract, or no enabled workers) are not persisted as active aggregates. Their task-level `dispatchStatus` remains the durable record.
3. When a queued blocker becomes terminal because of timeout or retry exhaustion, the aggregate for that user and worker type is resolved after the task updates succeed.
4. A successful dispatch continues to resolve active aggregates for that user and worker type.
5. Reactivating a previously resolved aggregate starts a new incident: `firstSeenAt` is reset to the new occurrence, `lastSeenAt` is updated, and the old `resolvedAt` is removed.

The existing active Codex and Claude status documents are resolved during deployment cleanup after their referenced tasks are confirmed terminal and the queue is empty.

## Dispatch Queue UX

Each active banner contains:

- worker type and normalized reason;
- live affected-task count;
- human-readable message and remediation;
- affected worker names;
- `Blocked since` with an absolute local date/time;
- `Last checked` with a relative time that refreshes every 30 seconds and exposes the absolute time;
- links to the example queued tasks returned by the API.

The empty state is displayed without blocker banners when there are no queued tasks. Terminal failure details remain available from Code Tasks and from each task's detail page.

## Logging and Sentry

Known dispatch capability blockers are domain outcomes, not thrown system failures:

- Keep structured logs with `taskId`, `userId` where available, `workerType`, `reason`, `workerNames`, terminal/recoverable state, and affected task count.
- Mark the expected capability-blocker logs with `_skipSentry: true`; they remain in process and Cloud logs.
- Log a terminal task outcome caused by a known blocker as a structured warning, also skipped by Sentry.
- Continue sending unexpected persistence, network, response-contract, and internal failures to Sentry.
- Keep task log, PR comment, and WhatsApp notification deduplication unchanged so the user still receives the actionable failure once.

This removes the Sentry amplification path while preserving complete operational evidence.

## Data and API Contracts

No endpoint is added or removed. Existing fields on `GET /code/queue` remain unchanged:

- `firstSeenAt`
- `lastSeenAt`
- `affectedTaskCount`
- `exampleTaskIds`
- `workerNames`

The frontend begins using the timestamp and example-task fields it already receives. Firestore document shape and security rules do not change.

## Testing

Test-first coverage will prove:

- terminal auth blockers do not upsert an active aggregate;
- recoverable blockers still upsert an active aggregate;
- a resolved aggregate reactivated later receives a fresh `firstSeenAt` and no `resolvedAt`;
- terminal drain paths resolve any previously active aggregate after affected tasks are failed;
- expected blocker logs carry `_skipSentry: true`, while unexpected dispatch failures do not;
- Dispatch Queue renders first/last timing and task links;
- an empty queue with no active aggregate renders only the empty state;
- the existing Home Dev `user-service` crash-loop regression remains fixed.

## Deployment and Verification

After full repository CI and review, the change is merged to `development`. The normal pipeline deploys Hetzner and Home Dev. Verification requires:

1. `user-service` remains healthy without the Matrix audience crash loop.
2. Dispatching `codex-xhigh` without Codex auth fails the task with precise task-level diagnostics and leaves no active queue banner.
3. The two stale aggregate documents are resolved after confirming their tasks are terminal.
4. No new occurrences of the crash-loop or expected-auth blocker Sentry groups appear after deployment.
5. Unexpected error capture remains operational.

## Non-Goals

- Installing or refreshing Codex/Claude authentication.
- Changing `defaultSentryWorkerType`.
- Adding a recent-failures/history section to Dispatch Queue.
- Hiding terminal failure information from Code Tasks.
- Suppressing unexpected infrastructure or programming failures.
