# INT-1551 Inventory: `task-dispatcher.ts` Decomposition

**Source:** `/repo/workers/orchestrator/src/services/task-dispatcher.ts` (3144 lines)
**Parent plan:** `docs/plans/2026-04-24-workers-layer-refactor.md` §10
**Goal:** Extract 4 modules → `workers/orchestrator/src/services/task-dispatcher/` so `task-dispatcher.ts` < 400 lines.

Existing siblings in `task-dispatcher/`: `classify-attempt.ts`, `decide-outcome.ts`, `error-messages.ts`, `lifecycle.ts`, `log-streaming.ts`, `metrics.ts`, `prompts.ts`, `retry-logic.ts`, `webhook-callbacks.ts`. The 4 new modules layer on top of these helpers.

Module key:
- **TR** = `task-runner.ts` (per-attempt execution: spawn docker, pipe logs)
- **TT** = `task-timers.ts` (idle/attempt timeouts + `AbortController` integration)
- **AL** = `attempt-lifecycle.ts` (attempt state transitions: start/teardown/resume/inactivity)
- **CP** = `completion-pipeline.ts` (success/failure pipeline: save summary, publish completion, metrics)
- **K** = KEEP_IN_DISPATCHER (top-level public API + thin orchestration glue)

---

## 1. Imports (top of file, lines 1–96)

External: `async-mutex` (`Mutex`), `@intexuraos/common-core` (`Result`, `Logger`, `getErrorMessage`).
Project types: `OrchestratorConfig`, `Task`, `TaskResult`, `TaskError`, `CreateTaskRequest`, `SendMessageResult`, `SendMessageError`.
Service deps: `StatePersistence`, `WorktreeManager`, `LogForwarder`, `WebhookClient`, `StatusUpdateClient`, `GitHubTokenService`, `IsolationProvider`+`WorkerConfig`+`WorkerHandle`+`WORKER_TYPES`, `TokenRefresher`, `ApiKeyValidator`, `WorkerAuthProvider`+`WorkerAuthRegistry`, `ActivityTimeoutManager`, `TurnMetricsCollector`, `AgentComplianceValidator`+`ComplianceValidationInput`.
Domain helpers: `buildSystemPrompt`, `stripDockerHeaders`, `verifyCompletion` family + `ResumeSummaryExtractor` + `getLast50ClaudeLines/Lines`, runtime registry (`getRuntime`, `RuntimeEvent`, `WorkerRuntime`), `fetchDispatchMetadata`, `withTimeout`.
Already-extracted task-dispatcher submodules: prompts, log-streaming, metrics, webhook-callbacks, lifecycle, retry-logic (constants), classify-attempt, error-messages, decide-outcome.
Metrics: `CODE_TASK_METRICS`, `mapTerminalStatusToMetricStatus`, `noopMetricsClient`, `MetricsClient`.

## 2. Free functions (top-level)

| Name                         | Lines     | Notes                                                                                                    |
| ---------------------------- | --------- | -------------------------------------------------------------------------------------------------------- |
| `adaptLegacyVerdictIfNeeded` | 114–195   | Test-only verdict shape adapter. Pure. → move to **CP** internal helper or leave near `runVerification`. |
| `runVerification`            | 204–235   | Exported. Runs verifier override OR `verifyCompletion`. → **CP**.                                        |
| `computeTaskDurationMs`      | 3132–3144 | Exported. Pure duration calc for metrics. → **CP**.                                                      |

## 3. Exported types / interfaces

| Name                                                                              | Lines   | Notes                                                           |
| --------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------- |
| Re-exports `getTaskEventUrl`, `hasFatalExitCodeField`, `buildMissingFieldsPrompt` | 99–101  | Backward-compat. Keep in dispatcher barrel.                     |
| `LegacyVerdict`                                                                   | 246–253 | Test-only. → **CP**.                                            |
| `DispatchError`                                                                   | 255–265 | Used by submitTask/adoptTask. → **K** (public dispatcher API).  |
| `CancelError`                                                                     | 267–271 | Used by cancelTask. → **K**.                                    |
| `IsolationConfig`                                                                 | 273–289 | Constructor input. → **K**.                                     |
| `VerifierOverrideForTests`                                                        | 300–315 | Test-only verifier hook. → **CP**.                              |
| `CompletionControlConfig`                                                         | 317–344 | Constructor input. → **K** (but verifier-shape parts → **CP**). |

## 4. Class fields (`TaskDispatcher`) — coupling map

| Field                         | Type                       | Read by                                                                                                                                                                           | Mutated by                                                              |
| ----------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `runningCount`                | number                     | submitTask, adoptTask, cancelTask, finalizeTask, executeTaskSetup, scheduleTimeoutKill, sendMessage, recoverPendingResumeTask, tryRecoverMissingTask                              | same set (capacity counter; mutex-guarded on increment in submit/adopt) |
| `capacityMutex`               | Mutex                      | submitTask, adoptTask                                                                                                                                                             | —                                                                       |
| `activeTasks`                 | Map<string,NodeJS.Timeout> | scheduleTimeoutWarning, scheduleTimeoutKill, startCompletionMonitoring, getRunningTaskIds, clearTaskTimers                                                                        | same                                                                    |
| `claudeErrors`                | Map                        | handleRuntimeEvents, handleTaskCompletion, handleResumedAfterSuccessCompletion, cancelTask, scheduleTimeoutKill, finalizeTask, startWorkerAttempt                                 | same                                                                    |
| `taskExitCodes`               | Map                        | handleTaskCompletion, handleResumedAfterSuccessCompletion, handleRuntimeEvents, scheduleTimeoutKill, finalizeTask, startWorkerAttempt                                             | same                                                                    |
| `attemptStartedAt`            | Map                        | handleTaskCompletion, scheduleTimeoutKill, finalizeTask, startWorkerAttempt                                                                                                       | same                                                                    |
| `attemptCompletionSignals`    | Set                        | startCompletionMonitoring, handleTaskCompletion, handleRuntimeEvents, handleResumedAfterSuccessCompletion, startWorkerAttempt, finalizeTask, scheduleTimeoutKill, clearTaskTimers | same                                                                    |
| `completionInProgress`        | Set                        | startCompletionMonitoring, doHandleInactivityRestart, scheduleTimeoutKill, cancelTask, clearTaskTimers                                                                            | same                                                                    |
| `inactivityRestartInProgress` | Set                        | startCompletionMonitoring, handleInactivityRestart                                                                                                                                | same                                                                    |
| `pendingMessages`             | Map<string,string[]>       | sendMessage, handleTaskCompletion, handleResumedAfterSuccessCompletion, cancelTask, finalizeTask                                                                                  | same                                                                    |
| `lastOutputAt`                | Map<string,number>         | startCompletionMonitoring, startWorkerAttempt (`onLog`), cancelTask, scheduleTimeoutKill, finalizeTask                                                                            | same                                                                    |
| `completionMaxAttempts`       | number                     | submitTask, adoptTask, executeTaskSetup, tryRecoverMissingTask                                                                                                                    | constructor only                                                        |
| `extractResumeSummaryFn`      | fn                         | handleResumedAfterSuccessCompletion                                                                                                                                               | constructor only                                                        |
| `verifyOverride`              | fn?                        | handleTaskCompletion → runVerification                                                                                                                                            | constructor only                                                        |
| `preserveWorkerContainers`    | boolean                    | finalizeTask                                                                                                                                                                      | constructor only                                                        |
| `activityTimeoutManager`      | ActivityTimeoutManager     | startWorkerAttempt (`start`/`touch`), scheduleTimeoutKill, doHandleInactivityRestart, clearTaskTimers (via fn)                                                                    | constructor wires the on-inactivity callback                            |
| `metrics`                     | MetricsClient              | emitTerminalMetrics                                                                                                                                                               | constructor only                                                        |

Constructor parameters (also accessed throughout): `config`, `statePersistence`, `worktreeManager`, `logForwarder`, `webhookClient`, `statusUpdateClient`, `logger`, `isolation`, `turnMetricsCollector?`, `agentComplianceValidator?`.

## 5. Class methods — symbol map

Format: `name | lines | one-line purpose | proposed module | state touched`.

### Public API (entrypoints)

| Method                     | Lines     | Purpose                                                                  | Module                                                                                                  | State touched                                                                                                                                                                                   |
| -------------------------- | --------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `submitTask`               | 479–507   | Accept new task: capacity check + fire-and-forget `executeTaskSetup`     | K                                                                                                       | `runningCount`, `capacityMutex`                                                                                                                                                                 |
| `adoptTask`                | 600–685   | Re-attach to a task on orchestrator restart (worktree rehydrate + start) | K (delegates to AL+TT)                                                                                  | `runningCount`, `capacityMutex`                                                                                                                                                                 |
| `cancelTask`               | 836–901   | Kill container, send cancellation webhook                                | K (calls AL.teardown + CP.finalize-ish — but is itself a top-level cancel that bypasses finalize logic) | `runningCount`, `claudeErrors`, `taskExitCodes`, `attemptStartedAt`, `attemptCompletionSignals`, `completionInProgress`, `pendingMessages`, `lastOutputAt`, `activeTasks` (via clearTaskTimers) |
| `sendMessage`              | 903–1038  | Queue/resume on user message                                             | K                                                                                                       | `runningCount`, `pendingMessages`                                                                                                                                                               |
| `getTask`                  | 1040–1043 | Read-only task lookup                                                    | K                                                                                                       | —                                                                                                                                                                                               |
| `recoverPendingResumeTask` | 1045–1064 | Recover an accepted-but-not-started resume after restart                 | K (calls AL)                                                                                            | `runningCount`                                                                                                                                                                                  |
| `getRunningCount`          | 1066–1068 | Counter accessor                                                         | K                                                                                                       | `runningCount`                                                                                                                                                                                  |
| `getCapacity`              | 1070–1072 | Config accessor                                                          | K                                                                                                       | —                                                                                                                                                                                               |
| `getRunningTaskIds`        | 1074–1078 | List active monitor keys                                                 | K (or TT)                                                                                               | `activeTasks`                                                                                                                                                                                   |
| `emitTerminalMetrics`      | 3106–3120 | Emit `code_tasks_*` counters/histogram on terminal                       | CP                                                                                                      | `metrics`                                                                                                                                                                                       |

### Setup / startup

| Method                             | Lines     | Purpose                                                   | Module                              | State touched                                                                    |
| ---------------------------------- | --------- | --------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------- |
| `checkDockerAvailability`          | 427–435   | Pre-flight gate                                           | K                                   | `isolation.provider`                                                             |
| `getRequiredWorkerAuthProvider`    | 437–448   | Map workerType → auth provider                            | K (private util, small)             | —                                                                                |
| `checkWorkerAuthAvailability`      | 450–477   | Auth gate before submit                                   | K                                   | `isolation.workerAuthRegistry`                                                   |
| `rehydrateWorktreeForAdoption`     | 521–598   | INT-1454 worktree-metadata repair on adopt                | AL                                  | `runningCount`, calls `finalizeTask` (CP) on terminal failure                    |
| `executeTaskSetup`                 | 687–820   | Build Task + worktree + first attempt + register monitors | AL (orchestrator-side; calls TR+TT) | `runningCount`, `logForwarder`, plus most maps via downstream calls              |
| `getDefaultRepository`             | 1080–1084 | Stub default repo                                         | K                                   | —                                                                                |
| `tryRecoverMissingTask`            | 1100–1184 | Recreate missing task from dispatch-metadata              | AL                                  | `runningCount`, `pendingMessages` (indirect)                                     |
| `recreateTaskFromDispatchMetadata` | 1186–1201 | Async tail of recovery                                    | AL                                  | —                                                                                |
| `resumeTaskWithUserMessage`        | 1203–1239 | Continue session after user message accepted              | AL                                  | calls TR.startWorkerAttempt + TT.scheduleTimeout* + TT.startCompletionMonitoring |

### Runtime helpers (thin delegators to existing submodules)

| Method                  | Lines     | Module             | Notes                                  |
| ----------------------- | --------- | ------------------ | -------------------------------------- |
| `resolveTaskRuntime`    | 1086–1088 | TR (utility)       | delegates to `lifecycle.ts`            |
| `getRuntimeDisplayName` | 1090–1092 | TR (utility)       | delegates to `lifecycle.ts`            |
| `saveTask`              | 1094–1098 | K (or shared util) | thin `statePersistence.modify` wrapper |

### Timers / monitor

| Method                      | Lines     | Purpose                                                                                 | Module                                                                                                             | State                                                                                                            |
| --------------------------- | --------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `scheduleTimeoutWarning`    | 1241–1258 | 5h warning timer                                                                        | TT                                                                                                                 | `activeTasks`                                                                                                    |
| `scheduleTimeoutKill`       | 1260–1341 | Hard kill at TASK_TIMEOUT_KILL_MS — destroys worker, flushes, sends interrupted webhook | TT (with help from CP for finalize/webhook portion — but the kill flow is bespoke and doesn't call `finalizeTask`) | `activeTasks`, `runningCount`, all maps + sets above                                                             |
| `startCompletionMonitoring` | 1505–1561 | Polls `isWorkerRunning` + `attemptCompletionSignals`; triggers `handleTaskCompletion`   | TT (driver) → calls CP.handleTaskCompletion                                                                        | `activeTasks`, `lastOutputAt`, `attemptCompletionSignals`, `completionInProgress`, `inactivityRestartInProgress` |
| `clearTaskTimers`           | 3073–3081 | Cancel all timers + signals for taskId                                                  | TT                                                                                                                 | `activeTasks`, `activityTimeoutManager`, `completionInProgress`, `attemptCompletionSignals`                      |

### Inactivity / restart

| Method                      | Lines     | Purpose                                               | Module                                                        | State                                                                                   |
| --------------------------- | --------- | ----------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `handleInactivityRestart`   | 1343–1353 | Wrapper that flips `inactivityRestartInProgress` flag | TT (timers package owns the inactivity callback already) → AL | `inactivityRestartInProgress`                                                           |
| `doHandleInactivityRestart` | 1355–1503 | The actual destroy+resume flow on inactivity timeout  | AL                                                            | `activityTimeoutManager`, calls TR.startWorkerAttempt, calls CP.finalizeTask on failure |

### Completion pipeline

| Method                                | Lines     | Purpose                                                                                                                           | Module                                                                    | State                                                                                                                                             |
| ------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `handleTaskCompletion`                | 1563–2186 | The mega-method: drives verifier, classifies, dispatches outcome (accept/retry/fail*), runs compliance validation, calls finalize | CP                                                                        | nearly everything: `claudeErrors`, `taskExitCodes`, `attemptStartedAt`, `attemptCompletionSignals`, `pendingMessages`, plus calls into TR, TT, AL |
| `finalizeAttemptAsInfraFailure`       | 2194–2242 | INT-1455 infra-failure terminal branch                                                                                            | CP                                                                        | calls finalizeTask                                                                                                                                |
| `buildResultFromVerification`         | 2244–2251 | Delegator to webhook-callbacks helper                                                                                             | CP (delegator only)                                                       | —                                                                                                                                                 |
| `enrichResultForResumedTask`          | 2253–2258 | Delegator                                                                                                                         | CP                                                                        | —                                                                                                                                                 |
| `finalizeTaskWithResult`              | 2260–2286 | Wraps `finalizeTask` w/ planning-unclear special case                                                                             | CP                                                                        | —                                                                                                                                                 |
| `buildResumePreamble`                 | 2288–2290 | Delegator to prompts module                                                                                                       | K (small util used by `sendMessage` + `tryRecoverMissingTask`, both in K) | —                                                                                                                                                 |
| `buildActiveGoalSection`              | 2292–2294 | Delegator to prompts module                                                                                                       | TR (used inside `startWorkerAttempt`)                                     | —                                                                                                                                                 |
| `parseRebaseResultOutput`             | 2302–2304 | Public test-spy delegator                                                                                                         | K (kept for test spies)                                                   | —                                                                                                                                                 |
| `parseContinuationPrOutput`           | 2312–2326 | Public test-spy delegator                                                                                                         | K                                                                         | —                                                                                                                                                 |
| `handleResumedAfterSuccessCompletion` | 2328–2463 | Loosened verification path for tasks resumed after success                                                                        | CP                                                                        | claudeErrors, taskExitCodes, attemptStartedAt, attemptCompletionSignals, pendingMessages                                                          |
| `finalizeTask`                        | 2715–2957 | The terminal sink: flush, preserve/teardown, emit metrics, status update, webhook                                                 | CP                                                                        | runningCount, all caches cleared, `metrics`, `activeTasks` (via clearTaskTimers), `pendingMessages`, etc.                                         |
| `checkForResult`                      | 2959–2961 | Delegator to webhook-callbacks helper                                                                                             | CP (used by TT timeout-kill + AL inactivity + CP completion)              | —                                                                                                                                                 |

### Per-attempt execution

| Method                | Lines     | Purpose                                                                                                      | Module                         | State                                                                                                                     |
| --------------------- | --------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `startWorkerAttempt`  | 2465–2678 | Build WorkerConfig, pull image, create container, wire onLog/onComplete callbacks, register inactivity timer | TR                             | `attemptCompletionSignals`, `claudeErrors`, `taskExitCodes`, `lastOutputAt`, `attemptStartedAt`, `activityTimeoutManager` |
| `teardownAttempt`     | 2680–2689 | Destroy worker + cleanup session if not keeping                                                              | AL (or TR — paired with start) | —                                                                                                                         |
| `failAcceptedResume`  | 2691–2713 | Convert resume-startup error → terminal failure                                                              | AL → CP                        | calls finalizeTask                                                                                                        |
| `handleRuntimeEvents` | 2963–3021 | Translate `RuntimeEvent[]` from runtime adapter into log/session/exit-code state                             | TR                             | `attemptCompletionSignals`, `taskExitCodes`, `claudeErrors`, persists task on session-id change                           |

### Glue: setup-failure webhook + log helpers + metrics delegators

| Method                             | Lines     | Module                                                                                             | Notes          |
| ---------------------------------- | --------- | -------------------------------------------------------------------------------------------------- | -------------- |
| `sendSetupFailureWebhook`          | 822–834   | K (used by `executeTaskSetup`)                                                                     | thin delegator |
| `appendOrchestratorTaskLog`        | 3023–3025 | shared util (TR/AL/CP all call) — keep on dispatcher OR put on a passed-in `LogStream` deps object | delegator      |
| `appendTaggedTaskLog`              | 3027–3029 | same                                                                                               | delegator      |
| `flushTaskLogs`                    | 3031–3033 | same                                                                                               | delegator      |
| `flushAndCloseLogForwarder`        | 3069–3071 | CP (only used by the compliance branch)                                                            | delegator      |
| `collectTurnMetrics`               | 3035–3037 | CP                                                                                                 | delegator      |
| `prepareComplianceValidationInput` | 3039–3053 | CP                                                                                                 | delegator      |
| `executeComplianceValidation`      | 3055–3067 | CP                                                                                                 | delegator      |

---

## 6. Grouping summary

### → `task-runner.ts` (TR)
- `startWorkerAttempt` (the heaviest method here)
- `handleRuntimeEvents`
- `resolveTaskRuntime`, `getRuntimeDisplayName` (small utilities used in the runner config)
- `buildActiveGoalSection` (delegator used inside startWorkerAttempt)

Estimated extracted lines: ~250 (mostly the body of `startWorkerAttempt`).

### → `task-timers.ts` (TT)
- `scheduleTimeoutWarning`
- `scheduleTimeoutKill` (largest — its self-contained kill flow may pull `checkForResult` along)
- `startCompletionMonitoring`
- `clearTaskTimers`
- `getRunningTaskIds` (reads `activeTasks`)
- The inactivity-callback wiring in the constructor (passed to `ActivityTimeoutManager`)

Estimated extracted lines: ~220.

### → `attempt-lifecycle.ts` (AL)
- `executeTaskSetup`
- `rehydrateWorktreeForAdoption`
- `tryRecoverMissingTask`, `recreateTaskFromDispatchMetadata`
- `resumeTaskWithUserMessage`
- `handleInactivityRestart` + `doHandleInactivityRestart`
- `teardownAttempt`
- `failAcceptedResume`

Estimated extracted lines: ~470.

### → `completion-pipeline.ts` (CP)
- `runVerification` (free function, already module-scope) + `adaptLegacyVerdictIfNeeded` + `LegacyVerdict` + `VerifierOverrideForTests`
- `handleTaskCompletion` (the mega-method)
- `handleResumedAfterSuccessCompletion`
- `finalizeAttemptAsInfraFailure`
- `finalizeTaskWithResult`
- `finalizeTask`
- `buildResultFromVerification`, `enrichResultForResumedTask` (delegators)
- `checkForResult` (delegator)
- `collectTurnMetrics`, `prepareComplianceValidationInput`, `executeComplianceValidation`, `flushAndCloseLogForwarder`
- `emitTerminalMetrics` + `computeTaskDurationMs`

Estimated extracted lines: ~1100.

### → KEEP in `task-dispatcher.ts` (K)
- Constructor + class fields
- `submitTask`, `adoptTask`, `cancelTask`, `sendMessage`, `getTask`, `recoverPendingResumeTask`, `getRunningCount`, `getCapacity`
- Pre-flight gates: `checkDockerAvailability`, `getRequiredWorkerAuthProvider`, `checkWorkerAuthAvailability`
- `saveTask`, `getDefaultRepository`
- `sendSetupFailureWebhook` (delegator)
- `buildResumePreamble` (delegator, used by `sendMessage` + `tryRecoverMissingTask`)
- Test-spy delegators: `parseRebaseResultOutput`, `parseContinuationPrOutput`
- Re-exports + log delegators (`appendOrchestratorTaskLog`, `appendTaggedTaskLog`, `flushTaskLogs`)
- Public `DispatchError`, `CancelError`, `IsolationConfig`, `CompletionControlConfig`

---

## 7. Coupling concerns

The 4 proposed modules cannot be independent classes — they all mutate the same `TaskDispatcher` private state. Two patterns work:

**A. Functional (preferred for low-line-count):** each module exports free functions taking a `DispatcherContext` (DTO carrying `logger`, `config`, `isolation`, `logForwarder`, `webhookClient`, `statusUpdateClient`, `statePersistence`, `worktreeManager`, `metrics`, `activityTimeoutManager`, plus the shared maps/sets/counters). The `TaskDispatcher` class becomes a thin façade that owns the state and routes calls.

**B. Sub-class composition:** each module is its own class instance instantiated by `TaskDispatcher`, sharing state via constructor-injected getters/setters. More lines, more boilerplate.

### Specific cross-module entanglements

1. **`runningCount` lifecycle.** Decremented in 7 places: `cancelTask`(K), `executeTaskSetup` error paths(AL), `adoptTask` error paths(K), `scheduleTimeoutKill`(TT), `finalizeTask`(CP), `tryRecoverMissingTask`(AL on increment only), `rehydrateWorktreeForAdoption`(AL on failure). Splitting these across 3 modules without contention requires a single "release slot" helper on the context object.

2. **The map/set state** (`claudeErrors`, `taskExitCodes`, `attemptStartedAt`, `attemptCompletionSignals`, `pendingMessages`, `lastOutputAt`, `completionInProgress`, `inactivityRestartInProgress`, `activeTasks`) is read+mutated from all 4 modules. They must live on the shared context. Cleanup is duplicated in `cancelTask`, `scheduleTimeoutKill`, `finalizeTask` — opportunity to consolidate into a `clearAttemptCaches(taskId)` helper used by all three.

3. **`scheduleTimeoutKill` vs `finalizeTask`.** TimeoutKill writes a status `interrupted` and sends a webhook *without* going through `finalizeTask`. This is intentional (it bypasses preserve-worker logic) but means TT and CP duplicate teardown logic. Consider routing TT's kill path through `finalizeTask(task, 'interrupted', { result })` to deduplicate (would require a small carve-out in finalize so the 'interrupted' branch can also flow through).

4. **`handleTaskCompletion` calls TR (`startWorkerAttempt` for retry/queued-msg-resume), AL (`teardownAttempt`), TT-relevant cleanup, plus its own pipeline.** This is the highest-coupling method. After extraction it will live in CP and import TR + AL helpers. No way around the cross-module call graph; the goal is just to make the call graph explicit (function imports) instead of `this.x()`.

5. **Constructor wiring.** `ActivityTimeoutManager` callback (line 419–423) calls `this.handleInactivityRestart`, which lives in AL. The dispatcher must construct AL first, then pass `al.handleInactivityRestart.bind(al)` (or the equivalent function) into `ActivityTimeoutManager`. Order: build context → build AL → build manager → inject manager into context.

6. **Log helpers (`appendOrchestratorTaskLog`, `appendTaggedTaskLog`, `flushTaskLogs`).** Called from all 4 modules. They must be on the shared context.

7. **`buildResumePreamble` is used by `sendMessage`(K) and `tryRecoverMissingTask`(AL).** Both can call the prompts.ts helper directly — no need to keep the dispatcher delegator if call-sites import the function.

8. **Test-spy delegators (`parseRebaseResultOutput`, `parseContinuationPrOutput`).** Tests use `getInternal(dispatcher).parseRebaseResultOutput(...)`. After extraction they must remain on the class (or `getInternal` must expose the helpers some other way) to avoid breaking tests.

## 8. Recommended extraction order (least → most coupled)

1. **TR (`task-runner.ts`)** — `startWorkerAttempt` + `handleRuntimeEvents` are mostly self-contained; they read/write state through clearly enumerated maps and only call `appendOrchestratorTaskLog` + `activityTimeoutManager`. Extract first, validate that tests still pass.
2. **TT (`task-timers.ts`)** — Timers manipulate `activeTasks` exclusively. The `scheduleTimeoutKill` flow is the main complication (calls `checkForResult` + sends a webhook directly). Extract second; if its kill path is later folded into CP.finalizeTask, the diff is local to TT.
3. **AL (`attempt-lifecycle.ts`)** — Depends on TR (start) and TT (timer scheduling) but not CP. Extract third.
4. **CP (`completion-pipeline.ts`)** — Depends on TR (resume in queued-msg branches), AL (teardown), and TT (clearTaskTimers). Largest and most central; extract last so the imports stabilize.

## 9. Estimated final line count for `task-dispatcher.ts`

Starting: 3144 lines.

Removed (approx):
- TR: ~250
- TT: ~220
- AL: ~470
- CP: ~1100 (incl. `finalizeTask` 243 lines + `handleTaskCompletion` 624 lines + `handleResumedAfterSuccessCompletion` 136 lines + smaller)

Total removed: ~2040 lines. Some lines (imports, constants used by multiple modules, banner comments) get duplicated across the 4 new files but the dispatcher net loss is ~2040.

Adds (approx, in dispatcher):
- New `DispatcherContext` type/object construction in constructor: ~40 lines.
- Re-exports + barrel updates: ~10 lines.
- Façade method bodies (one-liners delegating to module functions): ~50 lines.

**Final estimate: ~1200 lines.**

This **exceeds** the < 400 line target. To hit < 400 lines the following further moves are needed:
- Extract pre-flight gates (`checkDockerAvailability`, `checkWorkerAuthAvailability`, `getRequiredWorkerAuthProvider`) → small `pre-flight.ts` (~50 lines saved).
- Extract `sendMessage` (135 lines incl. the resume-from-completed branch) → `task-dispatcher/send-message.ts` (~135 lines saved).
- Extract `cancelTask` (66 lines) → `task-dispatcher/cancel.ts` or fold into AL (~66 lines saved).
- Extract `tryRecoverMissingTask` + `recreateTaskFromDispatchMetadata` (101 lines) into AL (already counted under AL above).
- Move test-spy delegators to a shared `internal.ts` (already a pattern in this repo) (~30 lines saved).
- Strip the large `adaptLegacyVerdictIfNeeded` adapter to CP (already counted) (~80 lines).

After these additional moves the dispatcher should land near **400–500 lines**. Hitting strict < 400 likely requires also extracting `submitTask` + `adoptTask` boilerplate into a `task-dispatcher/admission.ts` module that owns the capacity mutex.

## 10. Risk notes for executors

- The "v8 ignore" annotations are dense — preserve them verbatim during code moves; reformatting can cause coverage gates to fail.
- Tests reach into private state via `getInternal(dispatcher)` (see `parseRebaseResultOutput` / `parseContinuationPrOutput` comments). Audit `task-dispatcher.test.ts` for all such spy points before extracting class methods.
- Constructor must keep the `ActivityTimeoutManager` callback wiring intact: any reordering risks a stale closure capturing pre-extraction `this`.
- `finalizeTask` writes to `task.lastSuccessResult`, `task.completedAt`, `task.status`, `task.resumedAfterSuccess`, `task.pendingResumeStart` and emits the status-update HTTP commit. Treat as a single transactional unit during the move.
- `scheduleTimeoutKill` does its own teardown without going through `finalizeTask` — preserve this intentional bypass when relocating, or unify it (separate, more invasive change; do not do as part of decomposition).
