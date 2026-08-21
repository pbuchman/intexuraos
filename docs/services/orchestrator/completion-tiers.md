# Orchestrator Completion Verification — Tiered Telemetry

The orchestrator's `CompletionVerifier` splits missing-field failures into two categories:

- **Blocking (`missingFields`)** — deliverable contract fields (e.g. `gh_pr_url`, `review_comments_posted`, `tracking_comment_id`). Missing these always fails the task regardless of worker.
- **Telemetry (`telemetryMissingFields`)** — memory-acknowledgment fields (`memory_acknowledgment`, `memory_ids_*`, `memory_usage_summary`). These exist to measure memory-effectiveness; their absence should not fail an otherwise-valid task when the worker is known to be weaker.

Each worker type in `workers/orchestrator/src/services/isolation/types.ts:WORKER_TYPES` declares `telemetryExpectation`:

| Tier       | Workers                                                                                 | Behavior on telemetry-only failure                                                             |
| ---------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `required` | `auto`, `opus`, `sonnet`                           | Retry with the union of blocking + telemetry fields. Terminal fail after the last attempt.     |
| `optional` | `codex`, `codex-xhigh`, `openrouter-free`          | Accept as completed with a `warn` log line. `verificationHistory[n].telemetryAccepted = true`. |

## Ordering of completion gates

In `handleTaskCompletion` the gates run in this order:

1. **INT-1455 attempt classifier** (`classifyAttempt` in `task-dispatcher/classify-attempt.ts`) — infra-failed attempts short-circuit to `finalizeAttemptAsInfraFailure` and never reach the verifier.
2. **`verifyCompletion(...)`** — produces a `CompletionVerifierVerdict` with `missingRequired` and `telemetryMissing` already partitioned.
3. **`decideCompletionOutcome(verdict, tier, exitCode, attempt, maxAttempts)`** — pure policy function that returns a discriminated-union `CompletionOutcome`.
4. **Dispatcher dispatch on `outcome.kind`** — performs side effects (retry worker, finalize task, log).

## Policy helper

All retry/accept/fail decisions flow through `decideCompletionOutcome(...)` in `workers/orchestrator/src/services/task-dispatcher/decide-outcome.ts`. This is a pure function — test it in `decide-outcome.test.ts`, not in dispatcher tests.

## Compliance validation

Compliance validation (superpowers-usage check for execution tasks at `task-dispatcher.ts:prepareComplianceValidationInput`) runs **only for tier=required accepted tasks** (i.e. normal `accept` outcomes). Tier=optional accepted tasks (`outcome.telemetryAccepted === true`) skip compliance because weak models that skipped telemetry will also have skipped the disciplines compliance checks for, producing false failures.

## Observability note

Tier=optional accepted tasks may emit empty/missing `execution_memory_ids_used` etc. in their `TaskResult`. Downstream memory-effectiveness scoring may read these as "zero memories used" — indistinguishable from "worker rejected all memories." Filed as follow-up tech debt; not addressed in this change.
