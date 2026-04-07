# V8 Ignore Comment Triage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all V8 ignore override blocks with real tests across Orchestrator (118 blocks) and Code-Agent (198 blocks), then remove them from `v8-ignore-overrides.json` so that zero excluded V8 comments remain.

**Architecture:** Each service is triaged independently. For each V8 ignore block, the agent writes a targeted test that covers the ignored branch, then removes the V8 ignore comment. The `v8-ignore-overrides.json` file is cleaned up at the end of each task. Stale override entries for other services (whatsapp-service, internal-clients) that already have 0 blocks are also cleaned up.

**Tech Stack:** TypeScript, Vitest, nock (HTTP mocking), in-memory fakes, `app.inject()` for route tests.

---

## Investigation Findings

### Override File State (`v8-ignore-overrides.json`)

The user's assumption that **only Orchestrator and Code-Agent** have excluded V8 comments is **partially incorrect**. The overrides file contains 6 entries:

| Override Key                         | Service                   | Files    | Blocks Remaining |
| ------------------------------------ | ------------------------- | -------- | ---------------- |
| `PENDING-workers-orchestrator`       | workers/orchestrator      | 12 files | 118 blocks       |
| `PENDING-apps-code-agent`            | apps/code-agent           | 21 files | 198 blocks       |
| `PENDING-apps-todos-agent`           | apps/todos-agent          | 1 file   | 1 block          |
| `PENDING-apps-whatsapp-service` (x2) | apps/whatsapp-service     | 3 files  | 3 blocks         |
| `PENDING-packages-internal-clients`  | packages/internal-clients | 1 file   | 0 blocks (stale) |
| `INT-900`                            | apps/image-service        | 1 file   | 2 blocks         |

**Stale entries** (0 remaining blocks): `packages/internal-clients` (already cleaned up but override not removed). Additionally, some individual files within active override groups have 0 remaining blocks but are still listed in the overrides:
- **Orchestrator:** `workers/orchestrator/src/services/api-key-validator.ts` (0 blocks)
- **Code-Agent:** `apps/code-agent/src/infra/http/linearAgentHttpClient.ts` (0 blocks), `apps/code-agent/src/domain/usecases/submitToExecutionAgent.ts` (0 blocks), `apps/code-agent/src/infra/repositories/firestoreLogLineRepository.ts` (0 blocks), `apps/code-agent/src/routes/code/github-pr-summaries.ts` (0 blocks)

These stale file-level entries are cleaned up automatically when their parent override key is removed.

**Small residual entries** (1-3 blocks): `todos-agent` (1), `whatsapp-service` (3), `image-service` (2) = 6 blocks total across 3 services.

**Duplicate JSON key:** `PENDING-apps-whatsapp-service` appears twice in `v8-ignore-overrides.json` (lines 34 and 42) with identical content. `JSON.parse` silently drops the first occurrence. The cleanup should edit the raw file to remove both entries.

**Parallel execution note:** Both subtasks modify `v8-ignore-overrides.json`. Since they touch non-overlapping keys, there is no logical dependency, but whichever subtask commits second must rebase to resolve the merge conflict on this file.

**Recommendation:** The 6 residual blocks in other services and the stale entries should be cleaned up as part of these two tasks. The orchestrator task should clean up stale overrides; the code-agent task should address the 6 small residual blocks in other services since they follow identical patterns (ts-type, upstream categories).

### V8 Ignore Category Breakdown

**Orchestrator (118 blocks across 17 files):**

> **Scope note:** The override entry (`PENDING-workers-orchestrator`) lists 12 files, but 5 additional files (`credential-monitor.ts`, `token-refresher.ts`, `system-prompt.ts`, `webhook-client.ts`, `completion-verifier.ts`) have v8 ignore blocks that already pass static validation with proper categories. The task scope covers ALL 17 files — the goal is zero v8 ignore comments in the service, not just removing overrides.

| Category       | Count | Test Strategy                                                                                                   |
| -------------- | ----- | --------------------------------------------------------------------------------------------------------------- |
| `test-infra`   | 61    | Write tests with fake timers (`vi.useFakeTimers()`), mock `process.exit`, mock fs operations, mock Docker API   |
| `ts-type`      | 31    | Cover the type-narrowing branches by passing `undefined`/`null` inputs to trigger fallback paths                |
| `upstream`     | 13    | Use `nock` or fake HTTP clients to simulate external API error responses                                        |
| `source-map`   | 6     | These are bundling artifacts — test the template functions with varied inputs to cover all conditional branches |
| `module-init`  | 5     | Extract startup logic into testable functions, or test via `vi.importActual` with mocked env                    |
| `async-timing` | 2     | Use `vi.useFakeTimers()` + `vi.advanceTimersByTime()` to control async timing                                   |

**Code-Agent (198 blocks across 39 files):**

> **Scope note:** The override entry (`PENDING-apps-code-agent`) lists 21 files, but 18 additional files have v8 ignore blocks that already pass static validation with proper categories. The task scope covers ALL 39 files — the goal is zero v8 ignore comments in the service, not just removing overrides.

| Category       | Count | Test Strategy                                                                                  |
| -------------- | ----- | ---------------------------------------------------------------------------------------------- |
| `ts-type`      | 145   | Cover type-narrowing branches: pass `undefined` for optional fields, empty arrays, null values |
| `test-infra`   | 22    | Mock Firestore transactions, webhook validation, task dispatch                                 |
| `upstream`     | 12    | Simulate external service error paths (GitHub API, WhatsApp, Linear)                           |
| `schema`       | 8     | Pass invalid/edge-case payloads to trigger schema validation fallbacks                         |
| `auth-guard`   | 6     | Create a `FakeAuthPlugin` variant that returns null userId                                     |
| `async-timing` | 4     | Use fake timers for fire-and-forget `.catch()` handlers                                        |
| `regex`        | 1     | Pass input where regex capture group is absent                                                 |

### Files by Block Count

**Orchestrator top files:**
- `services/isolation/docker-provider.ts` — 30 blocks (test-infra heavy: Docker exec, container lifecycle)
- `services/task-dispatcher.ts` — 19 blocks (test-infra: race guards, setTimeout callbacks, worker infrastructure)
- `services/log-forwarder.ts` — 14 blocks (test-infra: Docker log streaming, file reading, chunk truncation)
- `start.ts` — 12 blocks (module-init + test-infra: process.exit, startup validation)
- `services/worktree-manager.ts` — 9 blocks (test-infra: git worktree operations)
- `services/system-prompt.ts` — 6 blocks (source-map: template conditionals)
- `github/token-service.ts` — 5 blocks (test-infra: setInterval, upstream: GitHub API)
- `routes.ts` — 4 blocks (ts-type: spread operators)
- `services/webhook-client.ts` — 3 blocks (ts-type + upstream)
- `services/turn-metrics-collector.ts` — 3 blocks (ts-type: array access guards + test-infra: cgroup mock)
- `services/repo-manager.ts` — 3 blocks (test-infra: fs race, mkdirSync failure)
- `services/isolation/credential-refresher.ts` — 3 blocks (upstream: container cleanup)
- `services/execution-deep-validator.ts` — 2 blocks (upstream: model guard)
- `services/completion-verifier.ts` — 2 blocks (upstream: JSON parse guard, model guard)
- `services/isolation/token-refresher.ts` — 1 block (ts-type)
- `services/isolation/credential-monitor.ts` — 1 block (ts-type)
- `scripts/view-metrics.ts` — 1 block (module-init: standalone CLI script)

**Code-Agent top files:**
- `routes/codeRoutes.ts` — 65 blocks (ts-type: optional property spreads, string comparisons)
- `routes/webhookRoutes.ts` — 18 blocks (ts-type: Result.ok checks, optional properties)
- `routes/workerSettingsRoutes.ts` — 15 blocks (auth-guard + ts-type: codeMap lookups)
- `domain/usecases/githubAgent.ts` — 13 blocks (upstream: tool handler guards, schema: type guards)
- `infra/repositories/firestoreCodeTaskRepository.ts` — 10 blocks (ts-type: optional property checks)
- `domain/services/unifiedEvaluator.ts` — 8 blocks (ts-type: conditional spreads)
- `infra/firestore/gitHubPREventsRepository.ts` — 7 blocks (upstream + ts-type: Firestore timestamp handling)
- `domain/services/logFormatter.ts` — 6 blocks (ts-type: noUncheckedIndexedAccess guards)
- `routes/webhooks/github.ts` — 5 blocks (async-timing: fire-and-forget catches)
- `infra/services/whatsappNotifierImpl.ts` — 5 blocks (ts-type + test-infra)
- Remaining 29 files: 1-4 blocks each

---

## Subtask 1: Orchestrator V8 Ignore Triage

**Service:** `workers/orchestrator`
**Block count:** 118 V8 ignore start blocks across 17 files
**Override key:** `PENDING-workers-orchestrator`

### Contract

**Input:** The `workers/orchestrator/src/` source tree with 118 V8 ignore blocks.

**Output:**
1. All 118 V8 ignore start/stop comment pairs removed from source files.
2. New/extended test files covering every previously-ignored branch.
3. `v8-ignore-overrides.json` updated: `PENDING-workers-orchestrator` entry removed. Also remove stale entries: `PENDING-packages-internal-clients` (0 blocks remaining).
4. `pnpm run verify:workspace:tracked -- orchestrator` passes with 100% branch coverage.
5. `pnpm run ci:tracked` passes.

**Dependencies on other subtasks:** None. This subtask is fully independent.

**Shared artifacts modified:**
- `v8-ignore-overrides.json` — removes `PENDING-workers-orchestrator` and `PENDING-packages-internal-clients` entries only. Does NOT touch `PENDING-apps-code-agent` or other entries.

### Approach by Category

#### test-infra (61 blocks)

These are the hardest blocks. Strategies per file:

**`docker-provider.ts` (30 blocks):** Mock the Docker API client (Dockerode). Create a `FakeDockerClient` that can simulate container create/start/exec/inspect/remove flows. Test error paths: exec stream failures, container inspect timeouts, container removal failures.

**`task-dispatcher.ts` (19 blocks):**
- Race guard blocks (`guard prevents negative runningCount`): Write tests that call `completeTask` twice concurrently to trigger the guard.
- `setTimeout` callbacks: Use `vi.useFakeTimers()` + `vi.advanceTimersByTime()`.
- Worker infrastructure block (lines 542-622): Create minimal fakes for Docker/SSH/state persistence interfaces.

**`log-forwarder.ts` (14 blocks):**
- Docker log streaming: Mock the Docker container attach response stream.
- File read errors: Mock `fs.readFile` to throw.
- 4MB chunk truncation: Generate a 4MB+ string and verify truncation.
- Chunk splitting: Test `splitOversizedChunk` with chunks exceeding limit.

**`start.ts` (12 blocks):**
- `process.exit()` blocks: Mock `process.exit` with `vi.spyOn(process, 'exit').mockImplementation()`.
- Startup validation: Extract validation logic into testable pure functions.
- Bootstrap function: Already module-init; extract testable parts.

**`worktree-manager.ts` (9 blocks):** Mock `child_process.execSync` to simulate git worktree add/remove success and failure.

**`token-service.ts` (5 blocks):** Use `vi.useFakeTimers()` for setInterval callback; mock GitHub API responses for token refresh failure.

**`repo-manager.ts` (3 blocks):** Mock `fs.statSync` to throw after `existsSync` returns true (race condition). Mock `fs.mkdirSync` to throw EACCES.

**`turn-metrics-collector.ts` (1 test-infra block):** Provide a cgroup mock that returns zero period to trigger the division guard.

#### ts-type (31 blocks)

Pass `undefined`, `null`, or narrowed types to trigger fallback branches. Example patterns:
- Optional spread: Pass objects without the optional field
- Nullish coalescing: Pass `undefined` for the LHS value
- Array access: Pass empty arrays to trigger `?? fallback`

#### upstream (13 blocks)

Use `nock` or fake HTTP clients to return error responses. Examples:
- GitHub API token refresh failure
- Docker exec stream errors
- `gh` CLI failure (mock `child_process.exec`)

#### source-map (6 blocks — `system-prompt.ts`)

These are template conditional branches misattributed after bundling. Test the prompt builder functions with varied input combinations to ensure all template branches are exercised.

#### module-init (5 blocks)

- `start.ts` bootstrap: Test by importing with mocked env vars
- `view-metrics.ts`: Standalone CLI script, wrap in `if (import.meta.url)` guard or test via subprocess

#### async-timing (2 blocks)

Use `vi.useFakeTimers()` to control `sendMessage`/`recoverPendingResumeTask` timing.

### Task Steps

- [ ] **Step 1:** Read all 17 source files, catalog each V8 ignore block with its line range and category.
- [ ] **Step 2:** For each file, write failing tests that target the ignored branches. Start with the simplest category (`ts-type`) to build momentum.
- [ ] **Step 3:** Run tests to confirm they pass and that coverage now includes the previously-ignored branches (V8 ignore exempts from coverage counting, not from test success).
- [ ] **Step 4:** Remove V8 ignore start/stop comment pairs from source files.
- [ ] **Step 5:** Run `pnpm run verify:workspace:tracked -- orchestrator` to verify 100% branch coverage.
- [ ] **Step 6:** Fix any coverage gaps by adding more targeted tests.
- [ ] **Step 7:** Update `v8-ignore-overrides.json`: remove `PENDING-workers-orchestrator` and `PENDING-packages-internal-clients` entries.
- [ ] **Step 8:** Run `pnpm run ci:tracked` to verify everything passes.
- [ ] **Step 9:** Commit with descriptive message referencing INT-1070.

---

## Subtask 2: Code-Agent V8 Ignore Triage

**Service:** `apps/code-agent`
**Block count:** 198 V8 ignore start blocks across 39 files
**Override key:** `PENDING-apps-code-agent`

### Contract

**Input:** The `apps/code-agent/src/` source tree with 198 V8 ignore blocks.

**Output:**
1. All 198 V8 ignore start/stop comment pairs removed from source files.
2. New/extended test files covering every previously-ignored branch.
3. `v8-ignore-overrides.json` updated: `PENDING-apps-code-agent` entry removed. Also remove remaining stale/small entries: `PENDING-apps-todos-agent` (1 block — write test and remove), `PENDING-apps-whatsapp-service` (3 blocks — write tests and remove, note: duplicate key in JSON), `INT-900` (2 blocks in image-service — write tests and remove).
4. After this subtask completes, `v8-ignore-overrides.json` should contain an empty `overrides` object: `{"_comment": "...", "overrides": {}}`.
5. `pnpm run verify:workspace:tracked -- code-agent` passes with 100% branch coverage.
6. `pnpm run ci:tracked` passes (including all affected workspaces: todos-agent, whatsapp-service, image-service).

**Dependencies on other subtasks:** None. This subtask is fully independent. The orchestrator subtask modifies different entries in `v8-ignore-overrides.json`.

**Shared artifacts modified:**
- `v8-ignore-overrides.json` — removes `PENDING-apps-code-agent`, `PENDING-apps-todos-agent`, `PENDING-apps-whatsapp-service` (both duplicate entries), and `INT-900` entries. After both subtasks complete, the overrides object should be empty.

### Cross-service cleanup (6 blocks)

These are small enough to include in this subtask:

1. **`apps/todos-agent/src/domain/usecases/reorderTodoItems.ts`** — 1 block (ts-type or upstream). Write one test in the existing test file.
2. **`apps/whatsapp-service/src/infra/firestore/phoneVerificationRepository.ts`** — 2 blocks. Write Firestore fake tests.
3. **`apps/whatsapp-service/src/infra/firestore/userMappingRepository.ts`** — 1 block. Write Firestore fake test.
4. **`apps/image-service/src/serviceFactory.ts`** — 2 blocks. Test env var fallback branches with `process.env` manipulation.

### Approach by Category

#### ts-type (145 blocks)

The largest category. Most are mechanical: pass inputs that trigger the fallback branch of nullish coalescing (`??`), optional chaining (`?.`), or conditional spreads.

**Pattern: optional property spread** (most common in `codeRoutes.ts`):
```typescript
// Source has: ...(field !== undefined ? { field } : {})
// Test: call the route WITHOUT the optional field in the request body
```

**Pattern: string literal comparison** (common in `codeRoutes.ts`):
```typescript
// Source has: if (error.code === 'SPECIFIC_CODE')
// Test: trigger the error path that produces each specific error code
```

**Pattern: noUncheckedIndexedAccess guard** (common in repositories):
```typescript
// Source has: const item = arr[0] ?? fallback
// Test: pass an empty array to trigger the fallback
```

#### test-infra (22 blocks)

**Firestore repositories (most blocks):** Use the existing `setServices({fakes})` pattern with in-memory fakes. For transaction-related blocks, mock the Firestore transaction runner.

**Webhook validation:** Mock crypto timing-safe comparison edge cases.

**Task dispatch:** Use fakes for the dispatch infrastructure.

#### upstream (12 blocks)

Simulate external service failures:
- GitHub API: `nock` interceptors returning 500/401
- Firestore Timestamp handling: Pass different Firestore types (Timestamp, Date, string)
- WhatsApp notifier: Mock HTTP client error responses

#### schema (8 blocks)

Pass payloads with edge-case values to trigger schema validation fallback branches. These are typically Fastify body/query schema defaults and Zod validation rejects.

#### auth-guard (6 blocks — `workerSettingsRoutes.ts`)

Create a `FakeAuthPlugin` that returns `null` for `userId`. The current `FakeAuthPlugin` always returns a valid user. Either:
- Add a config option to the fake: `new FakeAuthPlugin({ simulateNoUser: true })`
- Or mock the auth hook directly in the specific test

#### async-timing (4 blocks — `webhooks/github.ts`)

Fire-and-forget `.catch()` handlers. Use `vi.useFakeTimers()` + flush microtask queue to exercise the rejection path.

#### regex (1 block — `logFormatter.ts`)

Pass input where the regex match succeeds but capture group 2 is absent.

### Task Steps

- [ ] **Step 1:** Read all 39 source files, catalog each V8 ignore block.
- [ ] **Step 2:** Start with `ts-type` blocks (145) — these are the most mechanical. Write tests that pass `undefined`/`null`/empty values to cover fallback branches.
- [ ] **Step 3:** Address `test-infra` blocks (22) by extending existing test fakes.
- [ ] **Step 4:** Address `upstream` blocks (12) with `nock` interceptors and fake clients.
- [ ] **Step 5:** Address `schema` (8), `auth-guard` (6), `async-timing` (4), `regex` (1) blocks.
- [ ] **Step 6:** Remove all V8 ignore start/stop comment pairs from source files.
- [ ] **Step 7:** Run `pnpm run verify:workspace:tracked -- code-agent` to verify 100% branch coverage.
- [ ] **Step 8:** Address the 6 cross-service blocks (todos-agent, whatsapp-service, image-service). Write tests, remove V8 ignores, verify each workspace.
- [ ] **Step 9:** Update `v8-ignore-overrides.json`: remove all remaining entries so the overrides object is empty.
- [ ] **Step 10:** Run `pnpm run ci:tracked` to verify everything passes.
- [ ] **Step 11:** Commit with descriptive message referencing INT-1070.

---

## Endpoint Changes

No HTTP endpoints are modified, created, or removed. This is a test-coverage-only change.

## Verification

After both subtasks complete:
1. `v8-ignore-overrides.json` has empty overrides: `{"_comment": "...", "overrides": {}}`
2. `pnpm run ci:tracked` passes
3. Running `node scripts/verify-v8-ignore.mjs --no-overrides` produces zero validation errors for files that were previously in overrides
4. All remaining V8 ignore comments in the codebase pass static validation without needing overrides
