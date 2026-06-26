# Default Worker Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make default worker/model selection consistent for code task creation in the web UI, public/internal code-agent APIs, execution phase transitions, and Intex Agent-created code tasks.

**Architecture:** Code-agent is the source of truth for omitted `workerType` resolution. The web UI displays and submits the saved default for the selected mode, while Intex Agent omits `workerType` unless the user explicitly requests one so code-agent can apply settings defaults.

**Tech Stack:** TypeScript, Fastify, React/Vite, Vitest, Linear MCP, `@intexuraos/code-task-domain`, `@intexuraos/internal-clients`.

## Global Constraints

- No implementation coding in planning mode; implementation agents must edit code in their assigned subtasks.
- TDD applies: write failing tests first, confirm failure, implement minimal code, then run targeted verification.
- Use `pnpm run verify:workspace:tracked -- <workspace>` for changed workspaces and `pnpm run ci:tracked` before commit.
- Preserve existing worker configuration and no-enabled-worker dispatch behavior.
- Preserve explicit user/API `workerType` overrides.
- Preserve Linear worker label overrides.
- Plans with HTTP endpoints must include an Endpoint Changes section.
- Subtasks are direct children of INT-1698 and must be executable independently.

---

## Source Findings

- `apps/web/src/pages/CodeTaskNewPage.tsx` initializes `workerType` to `'auto'` and does not load `defaultPlanningWorkerType` or `defaultExecutionWorkerType`.
- Public `POST /code/submit` in `apps/code-agent/src/routes/code/task-routes.ts` creates tasks with `workerType: body.workerType ?? 'auto'`, so omitted API values ignore saved defaults.
- Internal `POST /internal/code/submit` defaults `workerType` to `'auto'` before calling `submitDirectCodeTask`.
- `submitDirectCodeTask` partially resolves `defaultPlanningWorkerType`, but it computes default selection before the final `agentType`; `taskMode: 'execution'` can still receive the planning default.
- `prepareSubmission` already applies `defaultExecutionWorkerType` when execution starts from planning, but it should use the same resolver as the other backend paths.
- Intex Agent code task creation lives in `apps/intex-agent/src/domain/agent/toolExecutor.ts`; it currently omits `workerType` when the tool args omit it, which is the correct delegation pattern.

## Key Decisions

- Code-agent owns omitted-worker defaults because all non-UI callers must get the same behavior without duplicating settings lookup.
- Resolution order is `Linear label workerType > explicit request workerType > saved default for resolved agentType > 'auto'`.
- Direct planning tasks use `defaultPlanningWorkerType`; direct execution tasks and phase-2 implementation tasks use `defaultExecutionWorkerType`.
- Intex Agent should not guess a worker model. It forwards explicit `workerType` only and otherwise relies on internal code-agent default resolution.
- The web UI should show the current saved default for the selected `taskMode`; changing between planning and execution resets the selected worker to that mode's saved default.

## Endpoint Changes

### Modified

- `POST /code/submit`: omitted `workerType` resolves from the saved default for resolved `taskMode`/`agentType`; explicit `workerType` still wins over settings.
- `POST /internal/code/submit`: omitted `workerType` remains omitted into domain logic; code-agent resolves the saved default by resolved `agentType`.
- `POST /code/tasks/:taskId/implement`: keep body schema the same, but share the same backend resolver for `defaultExecutionWorkerType`.

### Created

- None.

### Removed

- None.

### Unchanged

- Worker settings endpoints remain unchanged: `GET /worker-settings`, `PATCH /worker-settings/default-planning-worker-type`, `PATCH /worker-settings/default-execution-worker-type`.
- Intex Agent `create_code_task` tool schema remains `workerType` optional.
- `CreateCodeTaskRequest.workerType` in `packages/internal-clients` remains optional.

## Parallel Breakdown

### INT-1699: Code-Agent Backend

**Owns:** `apps/code-agent` worker resolution and persistence semantics.

**Contract:** Given `agentType`, optional request worker, optional Linear label worker, and user settings, code-agent returns a concrete `WorkerType`. No UI or Intex Agent code is changed here.

**Files:**
- Create: `apps/code-agent/src/domain/utils/defaultWorkerType.ts`
- Test: `apps/code-agent/src/__tests__/domain/utils/defaultWorkerType.test.ts`
- Modify: `apps/code-agent/src/routes/code/task-routes.ts`
- Modify: `apps/code-agent/src/domain/usecases/submitDirectCodeTask.ts`
- Modify: `apps/code-agent/src/domain/usecases/submitToExecutionAgent/prepareSubmission.ts`
- Test: `apps/code-agent/src/__tests__/routes/codeSubmit.test.ts`
- Test: `apps/code-agent/src/__tests__/routes/codeInternalSubmit.test.ts`
- Test: `apps/code-agent/src/__tests__/domain/usecases/submitToExecutionAgent/prepareSubmission.test.ts`

**Interfaces:**
- Produces:

```ts
import type { AgentType, WorkerType } from '../models/codeTask.js';
import type { UserWorkerSettings } from '../models/workerSettings.js';

export interface ResolveDefaultWorkerTypeInput {
  agentType: AgentType;
  requestedWorkerType?: WorkerType;
  labelWorkerType?: WorkerType;
  settings?: Pick<
    UserWorkerSettings,
    | 'defaultPlanningWorkerType'
    | 'defaultExecutionWorkerType'
    | 'defaultReviewWorkerType'
    | 'defaultRemediationWorkerType'
    | 'defaultPullRequestWorkerType'
  > | null;
}

export function resolveDefaultWorkerType(input: ResolveDefaultWorkerTypeInput): WorkerType;
```

**Steps:**

- [ ] Write failing unit tests for `resolveDefaultWorkerType`.

```ts
expect(resolveDefaultWorkerType({
  agentType: 'planning',
  settings: { defaultPlanningWorkerType: 'codex-xhigh' },
})).toBe('codex-xhigh');

expect(resolveDefaultWorkerType({
  agentType: 'execution',
  requestedWorkerType: 'opus',
  settings: { defaultExecutionWorkerType: 'codex-xhigh' },
})).toBe('opus');

expect(resolveDefaultWorkerType({
  agentType: 'execution',
  requestedWorkerType: 'opus',
  labelWorkerType: 'kimi',
  settings: { defaultExecutionWorkerType: 'codex-xhigh' },
})).toBe('kimi');
```

Run: `pnpm --filter @intexuraos/code-agent test -- src/__tests__/domain/utils/defaultWorkerType.test.ts`

Expected before implementation: FAIL because the utility does not exist.

- [ ] Implement `defaultWorkerType.ts` with a small switch over `agentType`.

```ts
function getSettingsDefault(
  agentType: AgentType,
  settings: ResolveDefaultWorkerTypeInput['settings']
): WorkerType | undefined {
  if (settings === null || settings === undefined) return undefined;
  switch (agentType) {
    case 'planning':
    case 'ask_agent':
      return settings.defaultPlanningWorkerType;
    case 'execution':
      return settings.defaultExecutionWorkerType;
    case 'review':
      return settings.defaultReviewWorkerType;
    case 'remediation':
      return settings.defaultRemediationWorkerType;
    case 'pull_request':
      return settings.defaultPullRequestWorkerType;
  }
}
```

Keep `ask_agent` mapped to planning only inside the utility for type completeness; do not change `/ask-agent/start` unless tests show code-task creation uses that route.

- [ ] Update public `/code/submit` to resolve settings before `codeTaskRepo.create`.

Behavior to preserve:
- If settings load succeeds, use settings defaults when `body.workerType` is omitted.
- If settings load fails, keep existing failure behavior and create the failed task with request worker or `'auto'`.
- If no workers are enabled, keep existing failed-task behavior but persist the resolved worker type when settings are available.

- [ ] Update internal `/internal/code/submit` and `submitDirectCodeTask`.

Change `SubmitDirectCodeTaskRequest.workerType` to optional, compute `effectiveAgentType` before resolving defaults, and call the shared resolver with `labelWorkerType`, `request.workerType`, and settings.

- [ ] Update `prepareSubmission` to call the shared resolver for execution transition.

Keep existing validation, active-task checks, plan PR merge, and complex fan-out behavior unchanged.

- [ ] Run backend targeted tests.

Commands:

```bash
pnpm --filter @intexuraos/code-agent test -- src/__tests__/domain/utils/defaultWorkerType.test.ts
pnpm --filter @intexuraos/code-agent test -- src/__tests__/routes/codeSubmit.test.ts
pnpm --filter @intexuraos/code-agent test -- src/__tests__/routes/codeInternalSubmit.test.ts
pnpm --filter @intexuraos/code-agent test -- src/__tests__/domain/usecases/submitToExecutionAgent/prepareSubmission.test.ts
pnpm run verify:workspace:tracked -- code-agent
```

### INT-1700: Web UI

**Owns:** `apps/web` New Code Task page state and tests.

**Contract:** The page reads worker settings and keeps the selected worker aligned with `taskMode` defaults until the user explicitly selects another worker for the current mode.

**Files:**
- Modify: `apps/web/src/pages/CodeTaskNewPage.tsx`
- Test: `apps/web/src/__tests__/CodeTaskNewPage.test.tsx`
- Optional Modify: `apps/web/src/hooks/useWorkerSettings.ts` only if a reusable hook shape is needed

**Interfaces:**
- Consumes existing `WorkerSettingsResponse`:

```ts
interface WorkerSettingsResponse {
  defaultPlanningWorkerType?: string;
  defaultExecutionWorkerType?: string;
}
```

- Produces unchanged `SubmitCodeTaskRequest.workerType?: CodeTaskWorkerType`.

**Steps:**

- [ ] Write failing UI tests for initial planning default.

Mock worker settings with `{ defaultPlanningWorkerType: 'codex-xhigh', defaultExecutionWorkerType: 'sonnet' }`, render `CodeTaskNewPage`, and assert the `Codex XHigh` button has the active class.

- [ ] Write failing UI tests for mode switch default alignment.

Render with planning default `codex-xhigh` and execution default `sonnet`, click `Execution`, and assert `Sonnet` is active before submit.

- [ ] Write failing submit payload test.

Fill a prompt, confirm submit, and assert `submitCodeTask` receives `workerType: 'sonnet'` after switching to execution.

- [ ] Implement settings load in `CodeTaskNewPage`.

Preferred approach:
- Call `useWorkerSettings()` from the page.
- Derive `getDefaultWorkerTypeForMode(mode)` as `defaultPlanningWorkerType ?? 'auto'` or `defaultExecutionWorkerType ?? 'auto'`.
- Initialize `workerType` to `'auto'`, then synchronize it from settings in an effect once settings load.
- When `taskMode` changes, set `workerType` to the new mode default.

- [ ] Preserve existing behavior.

Do not change prompt defaults, Linear issue selection, schedule validation, timeout handling, conflict modal handling, or the submit request shape except for the selected `workerType` value.

- [ ] Run web targeted tests.

Commands:

```bash
pnpm --filter @intexuraos/web test -- src/__tests__/CodeTaskNewPage.test.tsx
pnpm run verify:workspace:tracked -- web
```

### INT-1701: Intex Agent

**Owns:** `apps/intex-agent` code task tool request shape and optional internal-client type coverage.

**Contract:** Intex Agent forwards `workerType` only when the user/tool explicitly provides it. Omitted `workerType` must stay omitted so code-agent applies the saved default.

**Files:**
- Modify: `apps/intex-agent/src/domain/agent/toolExecutor.ts` only if implementation evidence shows it synthesizes `workerType`
- Test: `apps/intex-agent/src/__tests__/domain/toolExecutor.test.ts`
- Optional Test: `packages/internal-clients/src/code-agent/__tests__/client.test.ts`
- Optional Modify: `packages/internal-clients/src/code-agent/types.ts` only if strict typing has drifted from optional `workerType`

**Interfaces:**
- Consumes existing `CreateCodeTaskToolArgs.workerType?: string`.
- Produces existing `CreateCodeTaskRequest.workerType?: string`.

**Steps:**

- [ ] Write a failing regression test proving omitted `workerType` remains omitted.

```ts
await executor.createCodeTask({
  prompt: 'Plan the new import flow.',
});

expect(codeClient.calls).toEqual([
  {
    userId: 'user-1',
    prompt: 'Plan the new import flow.',
    taskMode: 'planning',
  },
]);
```

- [ ] Keep the explicit override test.

The existing test that passes `workerType: 'fullstack'` should continue to assert the field is forwarded unchanged.

- [ ] Confirm tool description does not instruct the model to invent defaults.

The `create_code_task` description should continue to describe `workerType` as optional and `taskMode` as planning by default.

- [ ] Run Intex Agent targeted tests.

Commands:

```bash
pnpm --filter @intexuraos/intex-agent test -- src/__tests__/domain/toolExecutor.test.ts src/__tests__/domain/toolDefinitions.test.ts
pnpm run verify:workspace:tracked -- intex-agent
```

Run `pnpm --filter @intexuraos/internal-clients test -- src/code-agent/__tests__/client.test.ts` only if internal-client serialization or types change.

## Final Verification

- [ ] Run every targeted command from each subtask.
- [ ] Run `pnpm run ci:tracked`.
- [ ] Manually verify these stored worker type outcomes in tests:
  - New planning task with omitted worker uses `defaultPlanningWorkerType`.
  - New execution task with omitted worker uses `defaultExecutionWorkerType`.
  - Implementation from planning with omitted worker uses `defaultExecutionWorkerType`.
  - Explicit UI/API worker selection overrides settings.
  - Intex Agent omitted worker remains omitted at the request boundary.

## Planning Artifacts

- Parent issue: https://linear.app/pbuchman/issue/INT-1698/ensure-consistent-default-worker-selection-across-ui-api-and-index
- Direct child: https://linear.app/pbuchman/issue/INT-1699/normalize-code-agent-default-worker-resolution
- Direct child: https://linear.app/pbuchman/issue/INT-1700/select-default-worker-model-in-code-task-ui
- Direct child: https://linear.app/pbuchman/issue/INT-1701/verify-intex-agent-code-task-default-worker-behavior
- Created: 2026-06-26T17:38:36Z
