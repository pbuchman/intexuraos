# Codex XHigh Worker Preset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public `codex-xhigh` worker preset that users can select end to end, with the Codex runtime configured for `xhigh` reasoning effort.

**Architecture:** Keep the existing Codex runtime and public worker-type flow intact. Introduce `codex-xhigh` as a new shared worker-type literal, map it to the existing Codex runtime with a higher effort preset inside the orchestrator, and expose the same key consistently in code-agent validation and web selectors without adding new endpoints or payload fields.

**Tech Stack:** TypeScript, Vitest, Fastify, React, shared package contracts, orchestrator runtime config, `gh`, `pnpm`

---

## Decisions

- Public worker key: `codex-xhigh`
- Runtime owner: `workers/orchestrator`
- Runtime mapping: `runtime='codex'`, `apiBaseUrl='https://api.openai.com'`, `effort='xhigh'`
- Effort mechanism: Codex CLI uses `model_reasoning_effort` in `~/.codex/config.toml` (valid values: `minimal`/`low`/`medium`/`high`/`xhigh`). Can also be passed via CLI override: `codex -c model_reasoning_effort=xhigh`. There is NO environment variable equivalent — this is fundamentally different from Claude's `CLAUDE_CODE_EFFORT_LEVEL` env var.
- Effort wiring strategy: The orchestrator must pass a new env var (e.g., `CODEX_REASONING_EFFORT=xhigh`) to the container, and `entrypoint.sh` must read it and inject `-c model_reasoning_effort=$CODEX_REASONING_EFFORT` into the `codex exec` command. The orchestrator's effort type union (`types.ts:32`) must be extended from `'low' | 'medium' | 'high' | 'max'` to also include `'xhigh'`.
- UI label: `Codex XHigh`
- UI description: `High-effort Codex preset for deeper reviews, investigations, and complex implementation tasks`
- Review-default policy: expose `codex-xhigh` as a selectable default review worker type, but do not migrate or auto-switch existing defaults in this change

## Endpoint Changes

### Modified

| Service                | Method  | Path                                                | Change                                                         |
| ---------------------- | ------- | --------------------------------------------------- | -------------------------------------------------------------- |
| `apps/code-agent`      | `POST`  | `/code/submit` and existing task-submit equivalents | Broaden request validation to accept `codex-xhigh`             |
| `apps/code-agent`      | `PATCH` | `/code/worker-settings/default-review-worker-type`  | Broaden enum validation to accept `codex-xhigh`                |
| `workers/orchestrator` | `POST`  | `/tasks`                                            | Broaden worker-type validation to accept `codex-xhigh`         |
| `apps/web`             | UI only | existing worker selectors                           | Show `Codex XHigh` anywhere shared worker types are selectable |

### Created

| Service | Method | Path | Change                        |
| ------- | ------ | ---- | ----------------------------- |
| None    | -      | -    | No new endpoints are required |

### Removed

| Service | Method | Path | Change               |
| ------- | ------ | ---- | -------------------- |
| None    | -      | -    | No endpoint removals |

### Unchanged

| Service                | Method   | Path                                     | Change                                                                |
| ---------------------- | -------- | ---------------------------------------- | --------------------------------------------------------------------- |
| `workers/orchestrator` | `POST`   | `/tasks/:id/message`                     | Resume/message semantics stay on the existing Codex runtime path      |
| `apps/code-agent`      | Webhooks | existing task-event/task-complete routes | Payload shape remains unchanged; only worker-type validation broadens |

## Execution Model

**Linear task:** `INT-1109` is the single parent task. There are **zero subtasks** — all work is tracked directly on INT-1109. Previous child issues INT-1112, INT-1113, INT-1114, INT-1115, and INT-1129 have been consolidated and closed.

**Execution:** Use `superpowers:subagent-driven-development` to implement Tasks 1-4 sequentially within a single branch/PR. Each task maps to a service boundary and is dispatched as a subagent. Do NOT create Linear subtasks.

| Task | Service boundary       | Scope                                                                              |
| ---- | ---------------------- | ---------------------------------------------------------------------------------- |
| 1    | `packages/common-core` | Canonical worker-type literal list and runtime guard                               |
| 2    | `workers/orchestrator` | Runtime preset, effort type extension, worker-type validation, orchestrator tests  |
| 3    | `apps/code-agent`      | Route/use-case validation, review-default persistence, review worker normalization |
| 4    | `apps/web`             | Worker selector labels and descriptions                                            |

## File Map

### Shared contract

- `packages/common-core/src/codeTaskWorkerTypes.ts`
- `packages/common-core/src/__tests__/codeTaskWorkerTypes.test.ts`
- `packages/common-core/src/index.ts` if an export surface needs to stay aligned

### Orchestrator

- `workers/orchestrator/src/services/isolation/types.ts` — `WORKER_TYPES` config and effort type union (extend to include `'xhigh'`)
- `workers/orchestrator/src/services/isolation/docker-provider.ts` — pass `CODEX_REASONING_EFFORT` env var for Codex containers
- `workers/code-worker/entrypoint.sh` — inject `-c model_reasoning_effort` into `codex exec` invocations
- `workers/orchestrator/src/types/api.ts`
- `workers/orchestrator/src/types/schemas.ts`
- `workers/orchestrator/src/services/system-prompt.ts`
- `workers/orchestrator/src/services/task-dispatcher.ts` — worker auth provider resolution (hardcodes `'codex'` runtime check)
- `workers/orchestrator/src/services/isolation/__tests__/types.test.ts`
- `workers/orchestrator/src/services/isolation/__tests__/docker-provider.test.ts` — effort level env var tests
- `workers/orchestrator/src/__tests__/types/types.test.ts`
- `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`
- Any focused orchestrator tests that assert worker-type routing or managed attempt config

### Code-agent

- `apps/code-agent/src/routes/codeRoutes.ts`
- `apps/code-agent/src/routes/workerSettingsRoutes.ts`
- `apps/code-agent/src/domain/models/codeTask.ts`
- `apps/code-agent/src/domain/usecases/createReviewTask.ts`
- `apps/code-agent/src/domain/usecases/createRemediationTask.ts`
- `apps/code-agent/src/domain/usecases/submitToExecutionAgent.ts` — worker type selection with labels
- `apps/code-agent/src/domain/usecases/createTaskForPR.ts` — task creation with worker type
- `apps/code-agent/src/domain/services/gitHubDispatchService.ts` — worker type extraction from dispatch directives
- `apps/code-agent/src/domain/utils/reviewTriage.ts`
- `apps/code-agent/src/domain/utils/dispatchWorkerTriage.ts`
- `apps/code-agent/src/domain/utils/labelUtils.ts` — `getWorkerTypeFromLabels()`
- `apps/code-agent/src/domain/prompts/issueCommentTriagePrompt.ts` — references `SUPPORTED_REVIEW_WORKER_TYPES`
- `apps/code-agent/src/__tests__/routes/codeSubmit.test.ts`
- Review triage helpers/prompts/tests that parse or normalize worker types

### Web

- `apps/web/src/components/workers/shared.tsx`
- `apps/web/src/components/workers/DefaultWorkerTypeCard.tsx`
- `apps/web/src/pages/CodeTaskNewPage.tsx`
- `apps/web/src/pages/WorkerSettingsPage.tsx`
- Focused tests for worker selection surfaces

## Task 1: Shared worker-type contract

**Files:**
- Modify: `packages/common-core/src/codeTaskWorkerTypes.ts`
- Modify: `packages/common-core/src/__tests__/codeTaskWorkerTypes.test.ts`
- Modify: `packages/common-core/src/index.ts` only if export wiring requires it

- [ ] Add `codex-xhigh` to the canonical `CODE_TASK_WORKER_TYPES` list in the intended public order, directly after `codex`.
- [ ] Extend the shared worker-type test to assert the updated list and confirm the runtime guard accepts `codex-xhigh`.
- [ ] Run `pnpm --filter @intexuraos/common-core test -- src/__tests__/codeTaskWorkerTypes.test.ts`.

## Task 2: Orchestrator runtime preset

**Files:**
- Modify: `workers/orchestrator/src/services/isolation/types.ts` — add `codex-xhigh` to `WORKER_TYPES` with `effort: 'xhigh'`, extend effort type union to include `'xhigh'`
- Modify: `workers/orchestrator/src/services/isolation/docker-provider.ts` — pass `CODEX_REASONING_EFFORT` env var for Codex runtime containers when effort is set
- Modify: `workers/code-worker/entrypoint.sh` — read `CODEX_REASONING_EFFORT` and inject `-c model_reasoning_effort=$value` into `codex exec` invocations
- Modify: `workers/orchestrator/src/types/api.ts`
- Modify: `workers/orchestrator/src/types/schemas.ts`
- Modify: `workers/orchestrator/src/services/system-prompt.ts`
- Modify: `workers/orchestrator/src/services/isolation/__tests__/types.test.ts`
- Modify: `workers/orchestrator/src/services/isolation/__tests__/docker-provider.test.ts` — test effort env var for codex-xhigh
- Modify: `workers/orchestrator/src/__tests__/types/types.test.ts`
- Modify: `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`
- Modify: any focused orchestrator tests that validate worker-type routing if they enumerate known presets

- [ ] Add `codex-xhigh` to orchestrator worker-type validation anywhere public worker-type enums are mirrored.
- [ ] Extend the `effort` type union in `types.ts:32` from `'low' | 'medium' | 'high' | 'max'` to `'low' | 'medium' | 'high' | 'max' | 'xhigh'`.
- [ ] Extend `WORKER_TYPES` so `codex-xhigh` uses `runtime='codex'`, `apiBaseUrl='https://api.openai.com'`, and `effort='xhigh'`.
- [ ] In `docker-provider.ts`, add `CODEX_REASONING_EFFORT` env var passing for Codex runtime containers. Currently `CLAUDE_CODE_EFFORT_LEVEL` is only set for `runtime === 'claude'` (line 650-663). In the Codex `else` branch (line 664), add: if `workerTypeConfig.effort !== undefined`, push `CODEX_REASONING_EFFORT=${workerTypeConfig.effort}` into the container env.
- [ ] In `workers/code-worker/entrypoint.sh`, update `run_codex_attempt()` to read `CODEX_REASONING_EFFORT` and inject `-c model_reasoning_effort=$CODEX_REASONING_EFFORT` into all `codex exec` invocations (4 call sites: lines 264, 270, 277, 283).
- [ ] Verify all `runtime === 'codex'` checks in `docker-provider.ts` and `task-dispatcher.ts` operate on the runtime field (not the worker type string) — they do, so `codex-xhigh` will inherit correct runtime behavior automatically.
- [ ] Update orchestrator system-prompt worker-type fallback text and focused tests anywhere supported public worker names are hardcoded.
- [ ] Keep `codex` unchanged and verify that no new route fields or response fields are introduced.
- [ ] Run `pnpm --filter orchestrator test -- src/services/isolation/__tests__/types.test.ts src/__tests__/types/types.test.ts src/services/isolation/__tests__/docker-provider.test.ts`.

## Task 3: Code-agent validation and review flows

**Files:**
- Modify: `apps/code-agent/src/routes/codeRoutes.ts`
- Modify: `apps/code-agent/src/routes/workerSettingsRoutes.ts`
- Modify: `apps/code-agent/src/domain/models/codeTask.ts` only if comments or docstrings still describe the old set inaccurately
- Modify: `apps/code-agent/src/domain/usecases/createReviewTask.ts`
- Modify: `apps/code-agent/src/domain/usecases/createRemediationTask.ts`
- Modify: `apps/code-agent/src/domain/usecases/submitToExecutionAgent.ts` — worker type selection with labels
- Modify: `apps/code-agent/src/domain/usecases/createTaskForPR.ts` — task creation with worker type
- Modify: `apps/code-agent/src/domain/services/gitHubDispatchService.ts` — dispatch directive worker type extraction
- Modify: `apps/code-agent/src/domain/utils/reviewTriage.ts`
- Modify: `apps/code-agent/src/domain/utils/dispatchWorkerTriage.ts`
- Modify: `apps/code-agent/src/domain/utils/labelUtils.ts` — label-to-worker-type mapping
- Modify: `apps/code-agent/src/domain/prompts/issueCommentTriagePrompt.ts` — `SUPPORTED_REVIEW_WORKER_TYPES` reference
- Modify: `apps/code-agent/src/__tests__/routes/codeSubmit.test.ts`
- Modify: review worker parsing/normalization helpers and focused tests that enumerate valid worker types

- [ ] Broaden submit/retry/review-related schemas and guards so `codex-xhigh` is accepted anywhere `CODE_TASK_WORKER_TYPES` drives validation.
- [ ] Ensure saved default review worker type can persist and later reuse `codex-xhigh` without changing existing fallback behavior.
- [ ] Audit and update worker-alias parsing plus focused submit/review tests so comment-driven and review-driven entry points recognize `codex-xhigh`.
- [ ] Update review worker normalization/parsing tests if any logic still assumes `codex` is the only Codex-family preset.
- [ ] Run focused code-agent tests covering route validation and review-default persistence.

## Task 4: Web worker selectors

**Files:**
- Modify: `apps/web/src/components/workers/shared.tsx`
- Modify: `apps/web/src/components/workers/DefaultWorkerTypeCard.tsx`
- Modify: `apps/web/src/pages/CodeTaskNewPage.tsx`
- Modify: `apps/web/src/pages/WorkerSettingsPage.tsx`
- Modify: focused tests for task creation and worker settings selectors

- [ ] Add the frozen label and description for `codex-xhigh` in the shared web worker metadata map.
- [ ] Confirm any selector that iterates over `CODE_TASK_WORKER_TYPES` renders `Codex XHigh` without special-casing.
- [ ] Cover the new option in focused UI tests for task creation and default review worker selection.
- [ ] Run focused web tests for the touched selection surfaces.

## Integration Checklist

- [ ] Verify all four tasks are implemented on a single branch before final CI.
- [ ] Run `pnpm run verify:workspace:tracked -- common-core`.
- [ ] Run `pnpm run verify:workspace:tracked -- orchestrator`.
- [ ] Run `pnpm run verify:workspace:tracked -- code-agent`.
- [ ] Run `pnpm run verify:workspace:tracked -- web`.
- [ ] Run `pnpm run ci:tracked`.
- [ ] Confirm the final PR description states `Fixes INT-1109`.

## Risks to Watch

- Code that special-cases `codex` by exact string may accidentally exclude `codex-xhigh`. **Mitigated:** all runtime-level checks in docker-provider.ts and task-dispatcher.ts use the `runtime` field from `WORKER_TYPES`, not the worker type string. Since `codex-xhigh` maps to `runtime='codex'`, these checks work automatically.
- Review worker parsing may need to recognize the longer token explicitly instead of falling back to `codex`.
- Codex CLI reasoning effort uses `model_reasoning_effort` in config.toml, NOT an environment variable. The orchestrator must bridge this gap: pass `CODEX_REASONING_EFFORT` env var to the container, then `entrypoint.sh` must translate it to `-c model_reasoning_effort=xhigh` on the `codex exec` command line. The effort type union must be extended to include `'xhigh'`.
- `dispatchWorkerTriage.ts` has a `WORKER_TYPE_ALIASES` map with `codex: 'codex'` — verify whether `codex-xhigh` needs an alias entry or if it should only be selectable by exact name.
