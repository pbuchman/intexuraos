# INT-1452 — Reduce WhatsApp Notification Noise (Planning Evidence)

- Linear: [INT-1452](https://linear.app/pbuchman/issue/INT-1452/reduce-whatsapp-notification-noise-by-alerting-only-on-actionable-task)
- Classification: SIMPLE
- Planning timestamp: 2026-04-23
- Worker: auto
- Model: default

## Goal

Adjust which code-task WhatsApp notifications are tagged `important: true` so that the "important" channel only fires on **actionable states** (ready-to-merge or ready-to-code), not on every task start.

## Current Behavior (baseline before change)

`apps/code-agent/src/infra/services/whatsappNotifierImpl.ts`:

| Notifier method                    | Current `important`   | Semantic meaning                                            |
| ---------------------------------- | --------------------- | ----------------------------------------------------------- |
| `notifyTaskComplete`               | *(not set)*           | Task finished, PR posted — "ready to merge"                 |
| `notifyTaskFailed`                 | `true`                | Task errored out                                            |
| `notifyTaskStarted`                | `true`                | Task dispatched to a worker                                 |
| `notifyTaskResumed`                | `true`                | Resumed/continued task                                      |
| `notifyResumedTaskComplete`        | `true`                | Resumed task finished — "ready to merge" (resumed)          |
| `notifyDesignComplete`             | `true`                | Phase 1 done — "ready to code / ready to go"                |
| `notifyTaskQueued`                 | *(not set)*           | Waiting for a worker slot                                   |
| `notifyTaskQueueExpired`           | `true`                | Queue timeout                                               |
| `notifyDispatchRetryExhausted`     | `true`                | Retries exhausted                                           |
| `notifyCIFailure`                  | *(not set)*           | CI check failed                                             |
| `notifyTaskAutoRetried`            | *(not set)*           | Auto-retry in progress                                      |
| `notifyTaskAutoRetryExhausted`     | `true`                | Auto-retry attempts exhausted                               |

## Desired Behavior

Per the user's task description:

> for important level, don't send notifications when code tasks are started; send them when they are ready to merge or ready to go (ready to code). All the others stay as they are.

Translated:

1. **Remove** `important: true` from `notifyTaskStarted` — starting is not actionable.
2. **Add** `important: true` to `notifyTaskComplete` — task completion means a PR is ready to merge.
3. **Keep** `important: true` on `notifyDesignComplete` — design complete = ready to code. ✅ already correct.
4. **Keep everything else unchanged** (including `notifyTaskResumed`, `notifyResumedTaskComplete`, `notifyTaskFailed`, queue/retry error notifications).

## File Changes

### `apps/code-agent/src/infra/services/whatsappNotifierImpl.ts`

- `notifyTaskStarted` (around line 209-216): drop the `important: true` key from the `publishSendMessage` call.
- `notifyTaskComplete` (around line 140-150): add `important: true` to the `publishParams` object. The publish params are built via a local variable, so the `important` flag must be added to the object literal (it is not an override).

### `apps/code-agent/src/__tests__/infra/services/whatsappNotifier.test.ts`

- In `describe('notifyTaskComplete')`: update the expected `publishSendMessage` call to include `important: true`. Remove the stale code comment at lines 546-548 that states `notifyTaskComplete` is NOT modified for INT-1418 importance flagging — that claim becomes obsolete.
- In `describe('notifyTaskStarted')`: add an assertion that the publish call does NOT set `important: true` (or that it's `undefined`).

## Implementation Steps (TDD)

1. **Test first (notifyTaskStarted):** Modify the existing "sends started notification with task details" test (or add a new test) to assert `callArgs.important` is `undefined`. Run — it should fail (current code passes `important: true`).
2. **Implementation:** Remove `important: true` from the `publishSendMessage` call inside `notifyTaskStarted`. Run the test again — it passes.
3. **Test first (notifyTaskComplete):** Modify the "sends notification with correlationId from traceId" test so the expected payload includes `important: true`. Run — it should fail (current code omits the flag).
4. **Implementation:** Add `important: true` to the `publishParams` object in `notifyTaskComplete`. Run the test again — it passes.
5. **Cleanup:** Remove the now-stale comment in `whatsappNotifier.test.ts` lines 546-548.
6. **Full suite:** `pnpm run verify:workspace:tracked -- code-agent` and `pnpm run ci:tracked` to confirm coverage and CI pass.

## Endpoint Changes

- Modified: none
- Created: none
- Removed: none
- Unchanged: all HTTP endpoints — this task only changes Pub/Sub payload metadata.

## Out of Scope (memory-guided scoping)

Per execution-memory guidance (mem_95dff382), complex state-dependent classifications (e.g., gating "important" on PR mergeability, CI status, or auto-merge state) are deferred. This task makes the minimal payload change that matches the user's explicit request.

## Notes on Resumed Task Semantics

`notifyTaskResumed` currently fires `important: true`. The user's request explicitly says "all the others stay as they are", and resume is distinct from start (it signals the agent picked up a session after interruption, which aligns with mem_9fc64e87 — resumed-task events are high-importance). Therefore `notifyTaskResumed` is **not** changed.

## Verification

- `pnpm run verify:workspace:tracked -- code-agent` passes.
- `pnpm run ci:tracked` passes from repo root.
- Branch coverage remains ≥ required threshold.

## Execution Memory Usage

- **mem_95dff382** (applied): scoped the change to the minimal flag adjustment; did not attempt PR-state-aware gating.
- **mem_9fc64e87** (applied): kept `notifyTaskResumed` at `important: true`.
- **mem_fb5906f4** (applied): reinforced the principle that user-actionable moments ("ready to merge", "ready to code") are important.
