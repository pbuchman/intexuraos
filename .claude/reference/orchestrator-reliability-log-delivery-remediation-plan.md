# Orchestrator Reliability + Guaranteed Log Delivery Remediation Plan

Date: 2026-02-13  
Status: Approved for implementation  
Scope: `workers/orchestrator`, `workers/claude-worker`, `apps/code-agent`  
Goal: eliminate retry/runtime ambiguity and guarantee that all task logs are delivered to code-agent (or fail the task explicitly).

## 1) Locked Decisions

1. Preserved failed/interrupted worker containers must be excluded from active concurrency limits.
2. The first worker attempt must wait for explicit worker readiness (no attempt execution before startup lifecycle completes).
3. Log delivery to code-agent is mandatory for task success:
   - all produced orchestrator+worker log chunks must be acknowledged by code-agent, or
   - task must fail with a dedicated log-delivery failure error.

## 2) Confirmed Issues (with proof pointers)

### I1. Preserved containers can leak orchestrator capacity

- `preserveFailedContainers` skips teardown path that calls `destroyWorker`.
- Worker slot removal is tied to `destroyWorker`, so preserved workers can stay in provider map and consume capacity.
- Proof:
  - `workers/orchestrator/src/task-dispatcher.ts:767`
  - `workers/orchestrator/src/task-dispatcher.ts:780`
  - `workers/orchestrator/src/services/isolation/docker-provider.ts:135`
  - `workers/orchestrator/src/services/isolation/docker-provider.ts:406`

### I2. Log-forwarder state reset can restart sequence numbers

- `flushAndStop()` deletes forwarder state.
- Later `appendChunk()` recreates state with `sequence = 0`.
- This can create duplicate sequence ranges for one task.
- Proof:
  - `workers/orchestrator/src/services/log-forwarder.ts:95`
  - `workers/orchestrator/src/services/log-forwarder.ts:217`
  - repeated calls from dispatcher around completion/retry:
    - `workers/orchestrator/src/services/task-dispatcher.ts:491`
    - `workers/orchestrator/src/services/task-dispatcher.ts:578`
    - `workers/orchestrator/src/services/task-dispatcher.ts:779`

### I3. First attempt can race startup lifecycle

- `run-attempt` is started immediately after container start.
- Worker entrypoint performs install/setup before managed wait loop.
- No readiness gate currently blocks attempt start until setup completes.
- Proof:
  - `workers/orchestrator/src/services/isolation/docker-provider.ts:273`
  - `workers/orchestrator/src/services/isolation/docker-provider.ts:327`
  - `workers/claude-worker/entrypoint.sh:171`
  - `workers/claude-worker/entrypoint.sh:181`

### I4. Startup failure can leave task secret directories on disk

- Secret/task dirs are created before image pull.
- Pull failure exits before worker registration; cleanup path does not remove per-task secret dir.
- Proof:
  - `workers/orchestrator/src/services/isolation/docker-provider.ts:162`
  - `workers/orchestrator/src/services/isolation/docker-provider.ts:583`
  - dispatcher cleanup currently calls session cleanup only:
    - `workers/orchestrator/src/services/task-dispatcher.ts:195`

### I5. Operational visibility is incomplete in task logs

- User-facing task logs do not always include clear orchestrator lifecycle reasons (verification rejection, retry reason, final fail cause).
- Existing improvements exist, but logging contract is not yet formalized end-to-end.

### I6. Image freshness and runtime identity are not strict enough

- Pull-on-create exists, but digest identity and compatibility need to be explicit and auditable per task.
- Need deterministic operator-visible “what image actually ran this task” evidence in one place.

## 3) Target State (Acceptance Criteria)

### A. Concurrency

- Preserved debug containers do not consume `maxConcurrent`.
- New tasks are blocked only by active running attempts, not preserved leftovers.

### B. Readiness

- Attempt 1 starts only after explicit worker-ready signal.
- No duplicate startup/install log streams in normal managed-attempt execution.

### C. Log Delivery Reliability

- Every produced sequence is either:
  - acknowledged and persisted by code-agent, or
  - task fails with `LOG_DELIVERY_FAILED`.
- No silent log loss on retries, restarts, or transient webhook failures.

### D. Image Observability

- For each task attempt, logs show:
  - requested image reference,
  - pulled+resolved digest,
  - compatibility check result.
- If image pull/compatibility fails, task setup fails fast with explicit reason.

### E. Cleanup Safety

- Task secret/session directories are cleaned on every startup failure path.

## 4) Detailed Design

## 4.1 Provider Concurrency Split (Active vs Preserved)

### Changes

- In `DockerProvider`, split worker tracking into:
  - `activeWorkers: Map<string, WorkerEntry>` (counts toward concurrency),
  - `preservedWorkers: Map<string, PreservedWorkerEntry>` (debug-only, non-counting).
- `maxConcurrent` checks use only `activeWorkers.size`.
- Add explicit preserve transition:
  - move worker from `activeWorkers` to `preservedWorkers`,
  - keep container running,
  - stop token refresh and task-session mutation.

### Interfaces

- Extend provider API with explicit preserve operation:
  - `preserveWorker(taskId: string): Promise<void>`
- Keep `destroyWorker(taskId)` semantics unchanged for actual teardown.

### Dispatcher behavior

- In `finalizeTask`:
  - if preserve enabled and terminal status is failed/interrupted, call `preserveWorker`.
  - otherwise call `destroyWorker`.

### Verification

- Unit tests:
  - preserved worker is not counted for capacity.
  - new task can start after preserving failed task.
  - preserved worker is discoverable via debug listing but not active list.

## 4.2 Readiness Gate Before First Attempt

### EntryPoint contract (`workers/claude-worker/entrypoint.sh`)

- Add readiness marker after startup lifecycle completes and before managed idle loop:
  - write `/tmp/worker-ready`.
- Startup lifecycle includes:
  - gcp auth,
  - github token setup,
  - dependency install.
- `run-attempt` path must refuse to run if marker missing (defensive check + clear error).

### Orchestrator contract (`docker-provider.ts`)

- After `container.start()`, wait for readiness marker using Docker exec:
  - `test -f /tmp/worker-ready`.
- Configurable timeout:
  - `INTEXURAOS_WORKER_READY_TIMEOUT_MS` default `600000` (10m).
- On timeout/failure:
  - remove container forcefully,
  - clean secrets/session dirs,
  - fail setup with explicit readiness error.

### Verification

- Unit tests:
  - readiness success path.
  - readiness timeout path removes container and fails.
  - run-attempt cannot start before ready.
- Integration test:
  - simulate slow install and verify no attempt logs before readiness event.

## 4.3 Guaranteed Log Delivery Protocol (At-Least-Once Transport, Idempotent Persist)

### 4.3.1 Orchestrator spool + monotonic sequence

- Replace ephemeral-only chunk state with durable spool:
  - file path: `~/.claude-orchestrator/log-spool/<taskId>.jsonl`
  - each entry contains `{taskId, sequence, content, timestamp, status}`.
- `sequence` is monotonic per task and never resets (across attempts).
- `flushAndStop` must not discard unsent or unacked entries.
- Add explicit methods:
  - `appendChunk(taskId, content)`
  - `flush(taskId)`
  - `awaitDrain(taskId, timeoutMs)`
  - `close(taskId)` (only after drain/final fail handling)

### 4.3.2 Code-agent idempotent storage

- In `FirestoreLogChunkRepository`, use deterministic doc IDs per sequence:
  - doc id format: zero-padded sequence (example `000000000123`).
- Duplicate delivery of same sequence overwrites same doc (idempotent).

### 4.3.3 Webhook ACK response

- Extend `/internal/logs` response payload:
  - `received: true`
  - `acknowledgedSequences: number[]`
  - `count: number`
- ACK is per-request explicit list of sequences accepted.

### 4.3.4 Finalization barrier

- Before sending terminal task webhook (`completed|failed|interrupted`):
  - call `logForwarder.flush(taskId)`,
  - wait `awaitDrain(taskId, LOG_DRAIN_TIMEOUT_MS)`.
- If drain timeout:
  - force terminal status `failed`,
  - error code `LOG_DELIVERY_FAILED`,
  - include pending-sequence stats.

### 4.3.5 Restart recovery

- On orchestrator start:
  - load spool files,
  - resume pending uploads for running and terminal-not-acked tasks.
- State persistence must include log-delivery progress fields:
  - `lastProducedSequence`,
  - `lastAckedSequence`,
  - `pendingSequenceCount`.

### Verification

- Unit tests:
  - sequence never resets after flush/retry.
  - duplicate send produces single Firestore record per sequence.
  - drain timeout forces terminal failure.
- Integration tests:
  - orchestrator restart mid-task resumes upload and drains pending chunks.
  - injected 5xx from code-agent causes retry and eventual delivery.
  - duplicate ACK/replay safety.

## 4.4 Startup Failure Cleanup Hardening

### Changes

- Wrap create-worker setup in `try/finally` with explicit cleanup on every failure branch:
  - `taskSecretsPath`,
  - `taskSessionPath`,
  - partially created container (if any).

### Verification

- Unit tests:
  - image pull failure cleans directories.
  - readiness failure cleans directories.
  - compatibility failure cleans directories.

## 4.5 Image Freshness + Identity Enforcement

### Changes

- Keep pull policy `always` for task container creation.
- Resolve and log digest on successful pull:
  - `requested=<env image ref>`
  - `resolved=<repo@sha256:...>`
- Persist resolved image digest in task metadata log line:
  - `[orchestrator] ... image.resolved=<digest>`
- Add startup warning when env uses mutable tag (`:latest`) instead of digest.

### Optional operator endpoint (recommended)

- Add read-only endpoint:
  - `GET /meta/worker-image`
  - returns `{configuredRef, lastResolvedDigest, pullPolicy, managedAttemptsMode}`.

### Verification

- Unit tests for digest resolution fallback behavior.
- Runtime check in deployment verification:
  - submit task, assert resolved digest appears in task log.

## 4.6 Orchestrator Task Log Event Contract

### Required task-log events

- dispatch accepted
- container create started/finished
- image pull requested/resolved
- readiness wait start/success/failure
- attempt start/complete (exit code)
- verification request start + verdict summary
- retry decision and reason
- log delivery stats (produced/acked/pending)
- terminal finalize reason

### Stdout vs file policy

- Stdout: concise one-line operational events.
- LLM full request/response payloads:
  - file audit only (`llm-audit.log`),
  - stdout only prints “LLM audit log saved” with metadata.

## 5) API / Type / Schema Changes

## Orchestrator

- `CompletionControlConfig`:
  - keep `preserveFailedContainers`,
  - add `logDrainTimeoutMs`.
- `DockerProviderConfig`:
  - add `workerReadyTimeoutMs`.
- state model additions:
  - per-task log delivery cursor fields.

## Code-agent

- `/internal/logs` response schema:
  - add `acknowledgedSequences`.
- log chunk repository:
  - deterministic doc-id strategy.

## 6) Rollout Plan

### Phase 1: Safety foundations (no protocol change yet)

1. Concurrency split for preserved workers.
2. Readiness gate and timeout.
3. Startup cleanup hardening.
4. Additional image digest logging.

### Phase 2: Log protocol v2 (spool + ACK + idempotency)

1. Add code-agent ACK response and deterministic IDs.
2. Add orchestrator spool and drain barrier.
3. Add restart recovery logic.

### Phase 3: Operational hardening

1. Add `/meta/worker-image` endpoint.
2. Add deployment verification command updates.
3. Add dashboards/alerts for:
   - `LOG_DELIVERY_FAILED`,
   - readiness timeouts,
   - pull failures,
   - pending spool growth.

## 7) Testing Strategy (Detailed)

## 7.1 Unit

- `workers/orchestrator/src/services/isolation/__tests__/docker-provider.test.ts`
  - preserved worker non-counting behavior.
  - readiness timeout cleanup.
  - image digest logs present.
- `workers/orchestrator/src/services/__tests__/log-forwarder.test.ts`
  - monotonic sequence across retries/flushes.
  - spool persistence and replay.
  - drain barrier behavior.
- `apps/code-agent/src/__tests__/routes/webhooks.test.ts`
  - `/internal/logs` ACK payload shape.
  - duplicate sequence idempotency.
- `apps/code-agent/src/__tests__/infra/repositories/firestoreLogChunkRepository.test.ts`
  - deterministic doc IDs and overwrite semantics.

## 7.2 Integration

- Orchestrator + fake code-agent:
  - injected 5xx/timeout and eventual ACK.
  - restart orchestrator mid-upload and verify recovery.
- Managed worker startup:
  - slow startup still yields single first-attempt execution (no race).

## 7.3 End-to-end (real env)

- Submit task in dev env.
- Verify:
  - resolved digest recorded in logs,
  - readiness event appears before first attempt,
  - verification/retry reasons appear in task logs,
  - final task status only set after log drain.

## 8) Verification Commands (Must Pass)

From repo root:

```bash
pnpm run verify:workspace:tracked code-agent
pnpm run verify:workspace:tracked orchestrator
pnpm run ci:tracked
```

Manual runtime verification:

```bash
# orchestrator logs
tail -f ~/.claude-orchestrator/logs/orchestrator.log

# audit file
tail -f ~/.claude-orchestrator/logs/llm-audit.log
```

## 9) Definition of Done

1. Capacity no longer leaks when failed/interrupted containers are preserved.
2. First attempt never starts before worker readiness.
3. Log delivery is guaranteed by protocol; undelivered logs force explicit task failure.
4. Sequence numbers are monotonic per task and survive retries/restarts.
5. Startup failures clean all task secrets/session artifacts.
6. Task logs clearly show orchestrator decisions (verification, retries, final reason).
7. Image resolved digest used by task is visible and auditable.
8. `pnpm run ci:tracked` passes.
