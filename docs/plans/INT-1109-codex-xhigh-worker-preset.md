# Codex XHigh Worker Preset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public `codex_xhigh` worker preset that users can select end to end, with the Codex runtime configured for `xhigh` reasoning effort.

**Architecture:** Keep the existing Codex runtime and public worker-type flow intact. Introduce `codex_xhigh` as a new shared worker-type literal, map it to the existing Codex runtime with a higher effort preset inside the orchestrator, and expose the same key consistently in code-agent validation and web selectors without adding new endpoints or payload fields.

**Tech Stack:** TypeScript, Vitest, Fastify, React, shared package contracts, orchestrator runtime config, `gh`, `pnpm`

---

## Decisions

- Public worker key: `codex_xhigh`
- Runtime owner: `workers/orchestrator`
- Runtime mapping: `runtime='codex'`, `apiBaseUrl='https://api.openai.com'`, `effort='xhigh'`
- UI label: `Codex XHigh`
- UI description: `High-effort Codex preset for deeper reviews, investigations, and complex implementation tasks`
- Review-default policy: expose `codex_xhigh` as a selectable default review worker type, but do not migrate or auto-switch existing defaults in this change

## Endpoint Changes

### Modified

| Service | Method | Path | Change |
| --- | --- | --- | --- |
| `apps/code-agent` | `POST` | `/code/submit` and existing task-submit equivalents | Broaden request validation to accept `codex_xhigh` |
| `apps/code-agent` | `PATCH` | `/code/worker-settings/default-review-worker-type` | Broaden enum validation to accept `codex_xhigh` |
| `workers/orchestrator` | `POST` | `/tasks` | Broaden worker-type validation to accept `codex_xhigh` |
| `apps/web` | UI only | existing worker selectors | Show `Codex XHigh` anywhere shared worker types are selectable |

### Created

| Service | Method | Path | Change |
| --- | --- | --- | --- |
| None | - | - | No new endpoints are required |

### Removed

| Service | Method | Path | Change |
| --- | --- | --- | --- |
| None | - | - | No endpoint removals |

### Unchanged

| Service | Method | Path | Change |
| --- | --- | --- | --- |
| `workers/orchestrator` | `POST` | `/tasks/:id/message` | Resume/message semantics stay on the existing Codex runtime path |
| `apps/code-agent` | Webhooks | existing task-event/task-complete routes | Payload shape remains unchanged; only worker-type validation broadens |

## Parallel Breakdown

All subissues are direct children of `INT-1109` and can be implemented in parallel because the contract below is fixed up front:

| Subissue | Owner | Boundary | Contract exposed to other work |
| --- | --- | --- | --- |
| `INT-1112` | `packages/common-core` | Canonical worker-type literal list and runtime guard | Exports `codex_xhigh` in `CodeTaskWorkerType`; does not own runtime or UI copy |
| `INT-1113` | `workers/orchestrator` | Runtime preset, worker-type validation, orchestrator tests | Resolves `codex_xhigh` to `codex` runtime with `xhigh` effort and unchanged session persistence |
| `INT-1114` | `apps/code-agent` | Route/use-case validation, review-default persistence, review worker normalization | Accepts/stores/passes through `codex_xhigh`; no runtime ownership |
| `INT-1115` | `apps/web` | Worker selector labels and descriptions | Displays `Codex XHigh` with the frozen copy above anywhere shared worker types are selectable |

## File Map

### Shared contract

- `packages/common-core/src/codeTaskWorkerTypes.ts`
- `packages/common-core/src/__tests__/codeTaskWorkerTypes.test.ts`
- `packages/common-core/src/index.ts` if an export surface needs to stay aligned

### Orchestrator

- `workers/orchestrator/src/services/isolation/types.ts`
- `workers/orchestrator/src/types/api.ts`
- `workers/orchestrator/src/types/schemas.ts`
- `workers/orchestrator/src/services/system-prompt.ts`
- `workers/orchestrator/src/services/isolation/__tests__/types.test.ts`
- `workers/orchestrator/src/__tests__/types/types.test.ts`
- `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`
- Any focused orchestrator tests that assert worker-type routing or managed attempt config

### Code-agent

- `apps/code-agent/src/routes/codeRoutes.ts`
- `apps/code-agent/src/routes/workerSettingsRoutes.ts`
- `apps/code-agent/src/domain/models/codeTask.ts`
- `apps/code-agent/src/domain/usecases/createReviewTask.ts`
- `apps/code-agent/src/domain/usecases/createRemediationTask.ts`
- `apps/code-agent/src/domain/utils/reviewTriage.ts`
- `apps/code-agent/src/domain/utils/dispatchWorkerTriage.ts`
- `apps/code-agent/src/__tests__/routes/codeSubmit.test.ts`
- Review triage helpers/prompts/tests that parse or normalize worker types

### Web

- `apps/web/src/components/workers/shared.tsx`
- `apps/web/src/components/workers/DefaultReviewWorkerTypeCard.tsx`
- `apps/web/src/pages/CodeTaskNewPage.tsx`
- Focused tests for worker selection surfaces

## Task 1: Shared worker-type contract (`INT-1112`)

**Files:**
- Modify: `packages/common-core/src/codeTaskWorkerTypes.ts`
- Modify: `packages/common-core/src/__tests__/codeTaskWorkerTypes.test.ts`
- Modify: `packages/common-core/src/index.ts` only if export wiring requires it

- [ ] Add `codex_xhigh` to the canonical `CODE_TASK_WORKER_TYPES` list in the intended public order, directly after `codex`.
- [ ] Extend the shared worker-type test to assert the updated list and confirm the runtime guard accepts `codex_xhigh`.
- [ ] Run `pnpm --filter @intexuraos/common-core test -- src/__tests__/codeTaskWorkerTypes.test.ts`.

## Task 2: Orchestrator runtime preset (`INT-1113`)

**Files:**
- Modify: `workers/orchestrator/src/services/isolation/types.ts`
- Modify: `workers/orchestrator/src/types/api.ts`
- Modify: `workers/orchestrator/src/types/schemas.ts`
- Modify: `workers/orchestrator/src/services/system-prompt.ts`
- Modify: `workers/orchestrator/src/services/isolation/__tests__/types.test.ts`
- Modify: `workers/orchestrator/src/__tests__/types/types.test.ts`
- Modify: `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`
- Modify: any focused orchestrator tests that validate worker-type routing if they enumerate known presets

- [ ] Add `codex_xhigh` to orchestrator worker-type validation anywhere public worker-type enums are mirrored.
- [ ] Extend `WORKER_TYPES` so `codex_xhigh` uses `runtime='codex'`, `apiBaseUrl='https://api.openai.com'`, and `effort='xhigh'`.
- [ ] Update orchestrator system-prompt worker-type fallback text and focused tests anywhere supported public worker names are hardcoded.
- [ ] Keep `codex` unchanged and verify that no new route fields or response fields are introduced.
- [ ] Run `pnpm --filter orchestrator test -- src/services/isolation/__tests__/types.test.ts src/__tests__/types/types.test.ts`.

## Task 3: Code-agent validation and review flows (`INT-1114`)

**Files:**
- Modify: `apps/code-agent/src/routes/codeRoutes.ts`
- Modify: `apps/code-agent/src/routes/workerSettingsRoutes.ts`
- Modify: `apps/code-agent/src/domain/models/codeTask.ts` only if comments or docstrings still describe the old set inaccurately
- Modify: `apps/code-agent/src/domain/usecases/createReviewTask.ts`
- Modify: `apps/code-agent/src/domain/usecases/createRemediationTask.ts`
- Modify: `apps/code-agent/src/domain/utils/reviewTriage.ts`
- Modify: `apps/code-agent/src/domain/utils/dispatchWorkerTriage.ts`
- Modify: `apps/code-agent/src/__tests__/routes/codeSubmit.test.ts`
- Modify: review worker parsing/normalization helpers and focused tests that enumerate valid worker types

- [ ] Broaden submit/retry/review-related schemas and guards so `codex_xhigh` is accepted anywhere `CODE_TASK_WORKER_TYPES` drives validation.
- [ ] Ensure saved default review worker type can persist and later reuse `codex_xhigh` without changing existing fallback behavior.
- [ ] Audit and update worker-alias parsing plus focused submit/review tests so comment-driven and review-driven entry points recognize `codex_xhigh`.
- [ ] Update review worker normalization/parsing tests if any logic still assumes `codex` is the only Codex-family preset.
- [ ] Run focused code-agent tests covering route validation and review-default persistence.

## Task 4: Web worker selectors (`INT-1115`)

**Files:**
- Modify: `apps/web/src/components/workers/shared.tsx`
- Modify: `apps/web/src/components/workers/DefaultReviewWorkerTypeCard.tsx`
- Modify: `apps/web/src/pages/CodeTaskNewPage.tsx`
- Modify: focused tests for task creation and worker settings selectors

- [ ] Add the frozen label and description for `codex_xhigh` in the shared web worker metadata map.
- [ ] Confirm any selector that iterates over `CODE_TASK_WORKER_TYPES` renders `Codex XHigh` without special-casing.
- [ ] Cover the new option in focused UI tests for task creation and default review worker selection.
- [ ] Run focused web tests for the touched selection surfaces.

## Integration Checklist

- [ ] Merge or rebase the four parallel branches so the shared worker-type literal is present before final CI.
- [ ] Run `pnpm run verify:workspace:tracked -- common-core`.
- [ ] Run `pnpm run verify:workspace:tracked -- orchestrator`.
- [ ] Run `pnpm run verify:workspace:tracked -- code-agent`.
- [ ] Run `pnpm run verify:workspace:tracked -- web`.
- [ ] Run `pnpm run ci:tracked`.
- [ ] Confirm the final PR description states `Fixes INT-1109`.

## Risks to Watch

- Code that special-cases `codex` by exact string may accidentally exclude `codex_xhigh`.
- Review worker parsing may need to recognize the longer token explicitly instead of falling back to `codex`.
- The orchestrator effort type currently uses provider-specific literals; if `xhigh` is not already accepted in the Codex path, update the type and tests in the same orchestrator change.
