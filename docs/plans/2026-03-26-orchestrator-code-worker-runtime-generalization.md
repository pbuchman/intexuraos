# Code Worker Runtime Generalization Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the orchestrator and current worker image so Claude and Codex can run from the same image with runtime-specific auth/state handling, then ship one initial `codex` worker type without regressing existing Claude workers.

**Architecture:** Introduce an internal runtime adapter layer in the orchestrator. Keep the shared image, but isolate runtime homes: Claude keeps shared-credential overlay plus per-task session dir; Codex gets shared auth plus per-task `.codex` state with persisted local SQLite state and a stored `threadId`. Normalize runtime events so worktree management, log forwarding, webhook delivery, and task lifecycle stay runtime-neutral.

**Tech Stack:** TypeScript, Fastify, Docker/Dockerode, Bash, Zod, Vitest, Claude CLI, Codex CLI, gh, pnpm

---

## Scope

- In scope:
  - Internal orchestrator runtime abstraction
  - Shared image support for Claude and Codex
  - Codex auth/state mount strategy
  - Codex runtime execution and resume support
  - One initial public worker type: `codex`
  - Docs and login flows needed to operate the new runtime
- Out of scope:
  - `codex_xhigh` rollout
  - Worker-image split unless the implementation proves the shared image is operationally broken
  - Rename-only cleanup detached from the functional runtime refactor

## Key Proven Constraints

- Codex non-interactive execution is viable via `codex exec --json`.
- Codex `resume` works only when local state is preserved.
- `auth.json` alone is not sufficient for true resume.
- `state_5.sqlite`-class local state is required alongside auth.
- Shared image remains viable.
- Shared runtime home does not.

## Endpoint Changes

### Modified

| Service | Method | Path | Change |
| --- | --- | --- | --- |
| `workers/orchestrator` | `POST` | `/tasks` | Accept a new public `workerType` value `codex` once the Codex runtime path is implemented and tested |
| `workers/orchestrator` | `GET` | `/tasks/:id` | Task payload may gain runtime-specific persisted metadata unless the route is explicitly normalized; implementation should prefer keeping runtime internals out of the external response |
| `apps/code-agent` | Internal contract | task payloads | No new field required; `workerType` enum broadens when `codex` is exposed |
| `apps/web` | UI/API | code-task creation and display | Worker type pickers and labels broaden to include `codex` |

### Created

| Service | Method | Path | Change |
| --- | --- | --- | --- |
| None required | - | - | No new HTTP endpoints are required for the first rollout slice |

### Removed

| Service | Method | Path | Change |
| --- | --- | --- | --- |
| None | - | - | No endpoint removals |

### Unchanged

| Service | Method | Path | Change |
| --- | --- | --- | --- |
| `workers/orchestrator` | `GET` | `/health` | Keep the existing endpoint; extend internals only if Codex auth status is surfaced later |
| `workers/orchestrator` | `POST` | `/tasks/:id/message` | Keep the endpoint; Codex runtime adapter must implement resume/message semantics behind the existing route |
| `apps/code-agent` | Webhooks | existing task-complete/task-event paths | No endpoint shape changes beyond the new `workerType` value |

## File Map

### Create

- `workers/orchestrator/src/services/runtime/types.ts`
  Runtime-neutral task execution types, normalized runtime events, runtime adapter contract.
- `workers/orchestrator/src/services/runtime/claude-runtime.ts`
  Claude-specific command/env/mount metadata, stream parsing, completion detection.
- `workers/orchestrator/src/services/runtime/codex-runtime.ts`
  Codex-specific command/env/mount metadata, JSON event parsing, `threadId` capture, resume semantics.
- `workers/orchestrator/src/services/runtime/index.ts`
  Runtime registry and workerType-to-runtime selection helpers.
- `workers/orchestrator/src/services/runtime/__tests__/claude-runtime.test.ts`
  Contract tests for Claude normalization behavior.
- `workers/orchestrator/src/services/runtime/__tests__/codex-runtime.test.ts`
  Contract tests for Codex JSON stream parsing, `threadId` capture, and resume behavior.
- `workers/orchestrator/scripts/codex-login.sh`
  Shared-auth bootstrap for Codex API-key login into a host-mounted auth directory.

### Modify

- `workers/orchestrator/src/services/isolation/types.ts`
  Replace Claude-centric `WorkerTypeConfig` assumptions with runtime-aware config and secret requirements.
- `workers/orchestrator/src/services/isolation/docker-provider.ts`
  Support runtime-specific home/state mounts, container naming, env injection, and cleanup behavior.
- `workers/orchestrator/src/services/task-dispatcher.ts`
  Consume runtime adapters instead of Claude-only parsing and completion logic.
- `workers/orchestrator/src/services/transcript-reader.ts`
  Split Claude transcript reading from runtime-neutral task-state reading.
- `workers/orchestrator/src/services/system-prompt.ts`
  Remove hard-coded Claude naming from generic worker text; keep Claude-specific wording inside the Claude runtime path only where necessary.
- `workers/orchestrator/src/types/task.ts`
  Persist runtime session metadata, likely including `runtime`, `runtimeSessionId`, and possibly task-local runtime paths if needed.
- `workers/orchestrator/src/types/api.ts`
  Keep the external `workerType` field, but reflect the broadened enum after `codex` is exposed.
- `workers/orchestrator/src/types/schemas.ts`
  Accept `codex` in the worker type schema.
- `workers/orchestrator/src/start.ts`
  Wire Codex auth bootstrap paths, runtime-aware secrets, and any startup validation.
- `workers/claude-worker/Dockerfile`
  Keep shared image strategy; add any Codex runtime defaults or directory bootstrap required for managed use.
- `workers/claude-worker/entrypoint.sh`
  Split shared container setup from runtime-specific attempt execution.
- `packages/common-core/src/codeTaskWorkerTypes.ts`
  Add `codex` only after the internal runtime path is implemented and tested.
- `packages/common-core/src/__tests__/codeTaskWorkerTypes.test.ts`
  Keep the canonical list in sync.
- `apps/web/src/pages/CodeTaskNewPage.tsx`
  Add visible `codex` worker metadata and selection UI.
- `apps/web/src/__tests__/CodeTaskNewPage.test.tsx`
  Cover the new worker type in the picker.
- `apps/actions-agent/src/domain/utils/workerTypeDetection.test.ts`
  Verify keyword detection remains correct when `codex` is introduced.
- `docs/services/orchestrator/technical.md`
  Update runtime architecture, auth flow, and mount model.
- `docs/services/claude-worker/technical.md`
  Explain the image’s transition toward a generic code-worker runtime while preserving Claude behavior.
- `docs/services/claude-worker/tutorial.md`
  Add Codex-specific login/runtime validation steps or split into a more neutral worker tutorial if the rename is included in the same implementation.

### Likely Test Files to Extend

- `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`
- `workers/orchestrator/src/services/isolation/__tests__/docker-provider.test.ts`
- `workers/orchestrator/src/__tests__/routes.test.ts`
- `workers/orchestrator/src/__tests__/types/types.test.ts`
- `workers/orchestrator/src/services/__tests__/transcript-reader.test.ts`

## Chunk 1: Runtime Adapter Scaffolding

### Task 1: Introduce internal runtime types without changing public behavior

**Files:**
- Create: `workers/orchestrator/src/services/runtime/types.ts`
- Create: `workers/orchestrator/src/services/runtime/index.ts`
- Modify: `workers/orchestrator/src/services/isolation/types.ts`
- Test: `workers/orchestrator/src/services/runtime/__tests__/claude-runtime.test.ts`

- [ ] **Step 1: Write failing tests for runtime selection and normalized event contract**

  Cover:
  - existing Claude worker types map to runtime `claude`
  - runtime adapter contract can emit normalized events like `log`, `runtime_session_started`, `attempt_completed`, `attempt_failed`

- [ ] **Step 2: Run the orchestrator tests to verify the new contract is missing**

  Run:

  ```bash
  pnpm --filter orchestrator test -- src/services/runtime/__tests__/claude-runtime.test.ts
  ```

  Expected: FAIL due to missing runtime module/types

- [ ] **Step 3: Add the runtime adapter interfaces and registry**

  Implement:
  - runtime adapter interface
  - normalized event/result types
  - internal helper mapping current worker types to `claude`

- [ ] **Step 4: Run the focused tests**

  Run:

  ```bash
  pnpm --filter orchestrator test -- src/services/runtime/__tests__/claude-runtime.test.ts
  ```

  Expected: PASS

- [ ] **Step 5: Typecheck the orchestrator workspace**

  Run:

  ```bash
  pnpm --filter orchestrator typecheck
  ```

  Expected: PASS

### Task 2: Move Claude-only parsing out of `task-dispatcher`

**Files:**
- Create: `workers/orchestrator/src/services/runtime/claude-runtime.ts`
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts`
- Test: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`
- Test: `workers/orchestrator/src/services/runtime/__tests__/claude-runtime.test.ts`

- [ ] **Step 1: Write failing tests for Claude stream parsing through the adapter**

  Cover:
  - `type: "result"` lines map to normalized completion
  - Claude error extraction continues to work
  - hook/system-message formatting stays intact

- [ ] **Step 2: Run the focused tests and confirm failure**

  Run:

  ```bash
  pnpm --filter orchestrator test -- src/__tests__/task-dispatcher.test.ts src/services/runtime/__tests__/claude-runtime.test.ts
  ```

  Expected: FAIL because the dispatcher still owns Claude-specific parsing

- [ ] **Step 3: Implement the Claude runtime adapter and delegate parsing**

  Move:
  - `detectClaudeError`
  - `flushClaudeErrorBuffer`
  - `parseClaudeLogLine`
  - `formatClaudeSystemMessages`

  into the Claude runtime path or into Claude-owned helpers called by that adapter.

- [ ] **Step 4: Re-run focused tests**

  Run:

  ```bash
  pnpm --filter orchestrator test -- src/__tests__/task-dispatcher.test.ts src/services/runtime/__tests__/claude-runtime.test.ts
  ```

  Expected: PASS

- [ ] **Step 5: Commit the scaffolding chunk**

  ```bash
  git add workers/orchestrator/src/services/runtime workers/orchestrator/src/services/task-dispatcher.ts workers/orchestrator/src/services/isolation/types.ts workers/orchestrator/src/__tests__/task-dispatcher.test.ts
  git commit -m "refactor(orchestrator): introduce runtime adapter scaffolding"
  ```

## Chunk 2: Codex Runtime in the Shared Image

### Task 3: Add task-local Codex state and shared Codex auth mounts

**Files:**
- Modify: `workers/orchestrator/src/services/isolation/docker-provider.ts`
- Modify: `workers/orchestrator/src/types/task.ts`
- Modify: `workers/orchestrator/src/start.ts`
- Create: `workers/orchestrator/scripts/codex-login.sh`
- Test: `workers/orchestrator/src/services/isolation/__tests__/docker-provider.test.ts`

- [ ] **Step 1: Write failing DockerProvider tests for Codex mount strategy**

  Cover:
  - shared Codex auth file is mounted separately from task-local runtime state
  - task `A` and task `B` get different Codex state directories
  - Claude mounts remain unchanged

- [ ] **Step 2: Run the focused DockerProvider tests**

  Run:

  ```bash
  pnpm --filter orchestrator test -- src/services/isolation/__tests__/docker-provider.test.ts
  ```

  Expected: FAIL because Codex mounts and task metadata do not exist yet

- [ ] **Step 3: Implement Codex auth/state path support**

  Requirements:
  - shared Codex auth path on host
  - per-task Codex runtime home
  - persisted task metadata sufficient to resume the same task safely
  - no shared `.codex` home between tasks

- [ ] **Step 4: Add `codex-login.sh`**

  Behavior:
  - launches the shared image in an interactive shell
  - mounts host Codex auth dir only
  - supports `codex login --with-api-key`
  - verifies an auth artifact exists afterward

- [ ] **Step 5: Re-run the focused tests**

  Run:

  ```bash
  pnpm --filter orchestrator test -- src/services/isolation/__tests__/docker-provider.test.ts
  ```

  Expected: PASS

### Task 4: Add Codex runtime adapter and thread-aware resume handling

**Files:**
- Create: `workers/orchestrator/src/services/runtime/codex-runtime.ts`
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts`
- Modify: `workers/orchestrator/src/types/task.ts`
- Test: `workers/orchestrator/src/services/runtime/__tests__/codex-runtime.test.ts`
- Test: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`

- [ ] **Step 1: Write failing tests for Codex JSON event parsing**

  Cover:
  - `thread.started` captures and persists `threadId`
  - `turn.completed` is recognized as terminal completion
  - item text is forwarded as readable logs
  - resume uses the stored `threadId` for the same task
  - auth-only resume regression is prevented by preserving task-local state

- [ ] **Step 2: Run the focused tests**

  Run:

  ```bash
  pnpm --filter orchestrator test -- src/services/runtime/__tests__/codex-runtime.test.ts src/__tests__/task-dispatcher.test.ts
  ```

  Expected: FAIL because Codex runtime behavior does not exist yet

- [ ] **Step 3: Implement the Codex adapter**

  Requirements:
  - construct `codex exec --json` command for first attempt
  - construct `codex exec resume --json <threadId>` for resumed attempt
  - normalize JSONL events into dispatcher-friendly signals
  - persist `threadId` in task state on first attempt
  - treat missing task-local state as a hard runtime error rather than silently forking a new thread

- [ ] **Step 4: Re-run focused tests**

  Run:

  ```bash
  pnpm --filter orchestrator test -- src/services/runtime/__tests__/codex-runtime.test.ts src/__tests__/task-dispatcher.test.ts
  ```

  Expected: PASS

### Task 5: Split entrypoint into shared setup plus runtime-specific attempt execution

**Files:**
- Modify: `workers/claude-worker/entrypoint.sh`
- Modify: `workers/claude-worker/Dockerfile`
- Test: `workers/orchestrator/src/services/isolation/__tests__/docker-provider.test.ts`

- [ ] **Step 1: Write failing tests for runtime-specific command selection**

  Cover:
  - Claude still executes `claude --print ...`
  - Codex executes `codex exec ...`
  - managed-mode readiness stays shared
  - child-process cleanup still runs after each attempt

- [ ] **Step 2: Run the focused tests**

  Run:

  ```bash
  pnpm --filter orchestrator test -- src/services/isolation/__tests__/docker-provider.test.ts
  ```

  Expected: FAIL until the entrypoint/runtime command split exists

- [ ] **Step 3: Refactor the entrypoint**

  Structure:
  - shared setup section
  - `run_claude_attempt`
  - `run_codex_attempt`
  - runtime switch based on env or an orchestrator-provided command selector

- [ ] **Step 4: Re-run focused tests**

  Run:

  ```bash
  pnpm --filter orchestrator test -- src/services/isolation/__tests__/docker-provider.test.ts
  ```

  Expected: PASS

- [ ] **Step 5: Run a local manual container validation**

  Run:

  ```bash
  ./scripts/build-worker-image.sh
  docker run --rm -it --entrypoint /bin/bash europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/claude-worker:latest
  ```

  Inside the container, verify:
  - `claude --version`
  - `codex --help`
  - shared setup still works for both runtimes

## Chunk 3: Public `codex` Worker Type Rollout

### Task 6: Add `codex` to the shared worker type contract

**Files:**
- Modify: `packages/common-core/src/codeTaskWorkerTypes.ts`
- Modify: `packages/common-core/src/__tests__/codeTaskWorkerTypes.test.ts`
- Modify: `workers/orchestrator/src/types/schemas.ts`
- Modify: `workers/orchestrator/src/types/api.ts`
- Modify: `workers/orchestrator/src/services/isolation/types.ts`
- Test: `workers/orchestrator/src/services/isolation/__tests__/types.test.ts`

- [ ] **Step 1: Write failing tests for the new worker type**

  Cover:
  - canonical worker type list includes `codex`
  - orchestrator runtime mapping routes `codex` to the Codex adapter
  - old Claude worker types still map to Claude

- [ ] **Step 2: Run the focused tests**

  Run:

  ```bash
  pnpm --filter orchestrator test -- src/services/isolation/__tests__/types.test.ts
  pnpm test -- packages/common-core/src/__tests__/codeTaskWorkerTypes.test.ts
  ```

  Expected: FAIL until `codex` is added

- [ ] **Step 3: Implement the enum/config changes**

  Keep:
  - one initial public Codex worker type only: `codex`

  Defer:
  - `codex_xhigh`

- [ ] **Step 4: Re-run focused tests**

  Run:

  ```bash
  pnpm --filter orchestrator test -- src/services/isolation/__tests__/types.test.ts
  pnpm --filter orchestrator typecheck
  pnpm typecheck:tests
  ```

  Expected: PASS

### Task 7: Update UI and worker-type-facing surfaces

**Files:**
- Modify: `apps/web/src/pages/CodeTaskNewPage.tsx`
- Modify: `apps/web/src/__tests__/CodeTaskNewPage.test.tsx`
- Modify: `apps/actions-agent/src/domain/utils/workerTypeDetection.test.ts`

- [ ] **Step 1: Write failing UI/tests for `codex`**

  Cover:
  - `codex` appears in the worker picker
  - description clearly distinguishes it from Claude-backed types
  - keyword detection does not regress when `codex` is added

- [ ] **Step 2: Run focused tests**

  Run:

  ```bash
  pnpm --filter @intexuraos/web test -- src/__tests__/CodeTaskNewPage.test.tsx
  pnpm test -- apps/actions-agent/src/domain/utils/workerTypeDetection.test.ts
  ```

  Expected: FAIL until the new worker type is exposed

- [ ] **Step 3: Implement the UI and detection updates**

- [ ] **Step 4: Re-run focused tests**

  Run:

  ```bash
  pnpm --filter @intexuraos/web test -- src/__tests__/CodeTaskNewPage.test.tsx
  ```

  Expected: PASS

### Task 8: Update docs and operational scripts

**Files:**
- Modify: `docs/services/orchestrator/technical.md`
- Modify: `docs/services/claude-worker/technical.md`
- Modify: `docs/services/claude-worker/tutorial.md`
- Modify: `workers/orchestrator/DEPLOYMENT.md`

- [ ] **Step 1: Update the docs after code lands**

  Required updates:
  - shared image, runtime-specific homes
  - Codex auth bootstrap
  - Codex task-local state requirement
  - initial `codex` worker type only

- [ ] **Step 2: Run docs/table formatting if needed**

  Run:

  ```bash
  pnpm format:docs-tables
  ```

- [ ] **Step 3: Commit the rollout chunk**

  ```bash
  git add packages/common-core workers/orchestrator workers/claude-worker apps/web apps/actions-agent docs
  git commit -m "feat(orchestrator): add codex runtime support"
  ```

## Chunk 4: Verification and Optional Rename Cleanup

### Task 9: Run tracked verification before merge

**Files:**
- Modify only if verification reveals failures

- [ ] **Step 1: Run workspace verification for orchestrator**

  Run:

  ```bash
  pnpm run verify:workspace:tracked -- orchestrator
  ```

  Expected: PASS

- [ ] **Step 2: Run orchestrator tests including e2e if fixtures support the new runtime**

  Run:

  ```bash
  pnpm --filter orchestrator test
  pnpm --filter orchestrator test:e2e
  ```

  Expected: PASS

- [ ] **Step 3: Run repo-wide tracked CI**

  Run:

  ```bash
  pnpm run ci:tracked
  ```

  Expected: PASS

### Task 10: Rename `claude-worker` to `code-worker` only after functional stability

**Files:**
- Modify: `workers/claude-worker/**`
- Modify: `workers/orchestrator/DEPLOYMENT.md`
- Modify: `docs/services/claude-worker/**`
- Modify: image-name references in orchestrator config/docs/scripts

- [ ] **Step 1: Confirm the functional rollout is stable**

  Preconditions:
  - Claude worker types still pass unchanged
  - `codex` worker type works in managed mode
  - docs and scripts are updated

- [ ] **Step 2: Rename paths and image references in one dedicated cleanup change**

  Keep this task separate from the first functional Codex rollout unless the diff remains small and reviewable.

- [ ] **Step 3: Re-run targeted verification after rename**

  Run:

  ```bash
  pnpm --filter orchestrator test
  pnpm run verify:workspace:tracked -- orchestrator
  ```

  Expected: PASS

## Rollout Guardrails

- Do not expose `codex` publicly until the Codex adapter passes task-local state persistence tests.
- Do not allow auth-only Codex resume; fail loudly if the task-local state DB is missing.
- Do not rename the worker image/path as a standalone refactor before the runtime abstraction is in place.
- Keep `codex_xhigh` out of the first rollout.

## Final Verification Checklist

- [ ] Claude-backed worker types still pass all existing orchestrator tests
- [ ] Codex first attempt emits JSONL events and stores `threadId`
- [ ] Codex resume reuses the same task-local state and preserved `threadId`
- [ ] Codex task `A` state is invisible to task `B`
- [ ] `POST /tasks` accepts `codex` only after the Codex runtime path is fully wired
- [ ] Web UI shows `codex` clearly and without regressing existing worker metadata
- [ ] `pnpm run ci:tracked` passes

## Planned Follow-Up

- Add `codex_xhigh` after the base `codex` worker type is stable and effort configuration is proven end to end.
- Revisit whether worker naming/docs should move fully from `claude-worker` to `code-worker` once the runtime adapter refactor is deployed cleanly.
