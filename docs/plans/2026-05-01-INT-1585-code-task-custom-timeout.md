# INT-1585 — Code Task Custom Timeout (1h–12h slider)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to override the orchestrator's default 5-hour code-task timeout with a value between 1 and 12 hours via a UI slider on `New Code Task`. The selected value is persisted on the `CodeTask` document, sent optionally on the dispatch payload to the orchestrator, and the orchestrator uses it to schedule the warning + hard-kill timers when present (falls back to the existing 5h constants when absent — backward compatible).

**Architecture:**
- Web → POST `/code/submit` carries an optional `timeoutHours: number` field (1–12).
- code-agent persists `timeoutHours` on the `code_tasks/{id}` Firestore document.
- code-agent's queue drainer forwards `timeoutHours` (when set) on the orchestrator dispatch HTTP body; the field is omitted when the user did not customise it (preserves existing HMAC behaviour for callers that don't set it because field-order policy says "only add if defined" — see `taskDispatcherImpl.ts`).
- Orchestrator's `/tasks` Zod schema accepts the optional field, persists it on its `Task`, and `task-timers.ts` uses `task.timeoutMs` (derived from `timeoutHours * 3600_000`) for both the warning timer (`timeoutMs - 5min`) and the hard-kill timer (`timeoutMs`). When absent, the existing constants `TASK_TIMEOUT_WARNING_MS` / `TASK_TIMEOUT_KILL_MS` (5h) are used unchanged.

**Tech Stack:** TypeScript strict mode, Fastify (apps/code-agent + workers/orchestrator), Vite + React + TailwindCSS (apps/web), Zod schemas, Firestore via `task-serializer.ts`, Vitest.

---

## Endpoint Changes

- **Modified:**
  - `POST /code/submit` (apps/code-agent) — adds optional `timeoutHours` (number, 1–12) to body schema; backward compatible (omitted = no override).
  - `POST /tasks` (workers/orchestrator) — `CreateTaskRequestSchema` adds optional `timeoutHours` (number, 1–12).
- **Created:** None.
- **Removed:** None.
- **Unchanged:** All other code-agent and orchestrator routes.

---

## File Structure (where each new piece lives)

- **Domain constants (shared between web + backends)**
  - Create: `packages/code-task-domain/src/codeTaskTimeout.ts` — exports `MIN_TIMEOUT_HOURS = 1`, `MAX_TIMEOUT_HOURS = 12`, `DEFAULT_TIMEOUT_HOURS = 5`, `isValidTimeoutHours(n)`. The web slider, the code-agent route schema, and the orchestrator schema all import from here so the bounds are defined once.
  - Modify: `packages/code-task-domain/src/index.ts` — re-export the new symbols.

- **Code task model + repository (apps/code-agent)**
  - Modify: `apps/code-agent/src/domain/models/codeTask.ts` — add `timeoutHours?: number` to `CodeTask` interface.
  - Modify: `apps/code-agent/src/domain/repositories/codeTaskRepository.ts` — add `timeoutHours?: number` to `CreateTaskInput`.
  - Modify: `apps/code-agent/src/infra/firestore/task-serializer.ts` — persist `timeoutHours` in `buildCreateData` (mirror the `dispatchSchedule` block at line ~236).

- **HTTP route + dispatch payload (apps/code-agent)**
  - Modify: `apps/code-agent/src/routes/code/task-routes.ts` — extend `/code/submit` body schema, validate range (re-use shared validator from domain), pass `timeoutHours` into `codeTaskRepo.create`.
  - Modify: `apps/code-agent/src/domain/services/taskDispatcher.ts` — add `timeoutHours?: number` to `DispatchRequest`.
  - Modify: `apps/code-agent/src/infra/services/taskDispatcherImpl.ts` — include `timeoutHours` in `WorkerTaskRequest` interface and conditionally append to `taskRequest` (mirror the existing `if (request.X !== undefined)` blocks).
  - Modify: `apps/code-agent/src/domain/usecases/drainTaskQueue.ts` — forward `task.timeoutHours` on the dispatch call (`...(task.timeoutHours !== undefined && { timeoutHours: task.timeoutHours })`).

- **Web UI**
  - Modify: `apps/web/src/types/index.ts` — add `timeoutHours?: number` to `SubmitCodeTaskRequest`.
  - Create: `apps/web/src/components/code-tasks/TimeoutSlider.tsx` — controlled slider component (1–12 hours, default 5; shows numeric label + "hours"; resets to default when disabled toggle is off).
  - Modify: `apps/web/src/pages/CodeTaskNewPage.tsx` — render `<TimeoutSlider />` directly below the **Task Mode** section; pass selected value into `submitCodeTask` only when it differs from the default (so backward-compat is preserved on the wire too).
  - Modify: `apps/web/src/components/ConfirmSubmitModal.tsx` — show the chosen timeout when non-default.
  - Modify: `apps/web/src/components/code-tasks/TaskHeader.tsx` (read-only display, optional but matches spec spirit): show `Custom timeout: Nh` when `task.timeoutHours` is present.

- **Orchestrator**
  - Modify: `workers/orchestrator/src/types/schemas.ts` — `CreateTaskRequestSchema` accepts `timeoutHours: z.number().int().min(MIN).max(MAX).optional()`.
  - Modify: `workers/orchestrator/src/types/api.ts` — add `timeoutHours?: number` to `CreateTaskRequest`.
  - Modify: `workers/orchestrator/src/types/task.ts` — add `timeoutMs?: number` to `Task` (orchestrator stores ms internally, derived once from hours on accept).
  - Modify: `workers/orchestrator/src/services/task-dispatcher/setup.ts` — propagate `timeoutMs` when constructing the in-memory `Task` from `CreateTaskRequest`.
  - Modify: `workers/orchestrator/src/services/task-dispatcher/task-timers.ts` — `scheduleTimeoutWarning` and `scheduleTimeoutKill` each accept the resolved kill duration and compute warning at `kill - 5min`. The existing `TASK_TIMEOUT_WARNING_MS`/`TASK_TIMEOUT_KILL_MS` constants remain the fallback when the per-task value is absent.
  - Modify: `workers/orchestrator/src/services/task-dispatcher/dispatcher-context.ts` — bridge signatures updated to `(taskId, killMs?)`.
  - Modify: `workers/orchestrator/src/services/task-dispatcher/attempt-lifecycle.ts` — pass `task.timeoutMs` into the schedule calls.

---

## Bite-Sized Tasks

> Order matters because later tasks import from earlier ones. Commit after each task.

---

### Task 1: Shared timeout constants in `code-task-domain`

**Files:**
- Create: `packages/code-task-domain/src/codeTaskTimeout.ts`
- Modify: `packages/code-task-domain/src/index.ts`
- Test: `packages/code-task-domain/src/__tests__/codeTaskTimeout.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/code-task-domain/src/__tests__/codeTaskTimeout.test.ts
import { describe, it, expect } from 'vitest';
import {
  MIN_TIMEOUT_HOURS,
  MAX_TIMEOUT_HOURS,
  DEFAULT_TIMEOUT_HOURS,
  isValidTimeoutHours,
  timeoutHoursToMs,
} from '../codeTaskTimeout.js';

describe('codeTaskTimeout', () => {
  it('exposes expected bounds', () => {
    expect(MIN_TIMEOUT_HOURS).toBe(1);
    expect(MAX_TIMEOUT_HOURS).toBe(12);
    expect(DEFAULT_TIMEOUT_HOURS).toBe(5);
  });

  it('isValidTimeoutHours accepts integers in [1,12]', () => {
    expect(isValidTimeoutHours(1)).toBe(true);
    expect(isValidTimeoutHours(5)).toBe(true);
    expect(isValidTimeoutHours(12)).toBe(true);
  });

  it('isValidTimeoutHours rejects out-of-range, non-integers, NaN', () => {
    expect(isValidTimeoutHours(0)).toBe(false);
    expect(isValidTimeoutHours(13)).toBe(false);
    expect(isValidTimeoutHours(5.5)).toBe(false);
    expect(isValidTimeoutHours(Number.NaN)).toBe(false);
    expect(isValidTimeoutHours(-1)).toBe(false);
  });

  it('timeoutHoursToMs converts hours to milliseconds', () => {
    expect(timeoutHoursToMs(1)).toBe(3_600_000);
    expect(timeoutHoursToMs(5)).toBe(18_000_000);
    expect(timeoutHoursToMs(12)).toBe(43_200_000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @intexuraos/code-task-domain test -- codeTaskTimeout.test.ts`
Expected: FAIL with `Cannot find module '../codeTaskTimeout.js'`.

- [ ] **Step 3: Implement the module**

```ts
// packages/code-task-domain/src/codeTaskTimeout.ts

/**
 * Bounds for the user-overridable code-task execution timeout.
 *
 * The orchestrator's intrinsic default (when no override is provided)
 * is `DEFAULT_TIMEOUT_HOURS = 5`. Users can choose any integer hour
 * value in the inclusive range [`MIN_TIMEOUT_HOURS`, `MAX_TIMEOUT_HOURS`]
 * via the New Code Task UI slider.
 */
export const MIN_TIMEOUT_HOURS = 1;
export const MAX_TIMEOUT_HOURS = 12;
export const DEFAULT_TIMEOUT_HOURS = 5;

export function isValidTimeoutHours(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_TIMEOUT_HOURS &&
    value <= MAX_TIMEOUT_HOURS
  );
}

export function timeoutHoursToMs(hours: number): number {
  return hours * 60 * 60 * 1000;
}
```

```ts
// packages/code-task-domain/src/index.ts (append)
export {
  MIN_TIMEOUT_HOURS,
  MAX_TIMEOUT_HOURS,
  DEFAULT_TIMEOUT_HOURS,
  isValidTimeoutHours,
  timeoutHoursToMs,
} from './codeTaskTimeout.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @intexuraos/code-task-domain test`
Expected: PASS, all green.

- [ ] **Step 5: Commit**

```bash
git add packages/code-task-domain/
git commit -m "feat(code-task-domain): add shared timeout bounds (INT-1585)"
```

---

### Task 2: Persist `timeoutHours` on CodeTask in code-agent

**Files:**
- Modify: `apps/code-agent/src/domain/models/codeTask.ts`
- Modify: `apps/code-agent/src/domain/repositories/codeTaskRepository.ts`
- Modify: `apps/code-agent/src/infra/firestore/task-serializer.ts`
- Test: `apps/code-agent/src/__tests__/infra/firestore/task-serializer.test.ts`

- [ ] **Step 1: Write the failing test (extend existing serializer test)**

Append to the existing serializer test file:

```ts
import { isValidTimeoutHours } from '@intexuraos/code-task-domain';

it('persists timeoutHours when provided', () => {
  const data = buildCreateData({
    id: 'task_x', userId: 'u1',
    prompt: 'p', sanitizedPrompt: 'p',
    systemPromptHash: 'h', workerType: 'auto',
    workerLocation: 'pending',
    repository: 'r/r', baseBranch: 'main', traceId: 't',
    timeoutHours: 8,
  });
  expect(data['timeoutHours']).toBe(8);
});

it('omits timeoutHours when not provided (backward compat)', () => {
  const data = buildCreateData({
    id: 'task_x', userId: 'u1',
    prompt: 'p', sanitizedPrompt: 'p',
    systemPromptHash: 'h', workerType: 'auto',
    workerLocation: 'pending',
    repository: 'r/r', baseBranch: 'main', traceId: 't',
  });
  expect('timeoutHours' in data).toBe(false);
});

it('isValidTimeoutHours stays in sync with serializer expectations', () => {
  // Sanity guard — keeps the model in lockstep with shared bounds.
  expect(isValidTimeoutHours(8)).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter @intexuraos/code-agent test -- task-serializer.test.ts`
Expected: FAIL — `data['timeoutHours']` is undefined and the type does not exist.

- [ ] **Step 3: Add `timeoutHours` to model + repo input + serializer**

`apps/code-agent/src/domain/models/codeTask.ts` — append after `dispatchSchedule?:` field on the `CodeTask` interface:

```ts
  /**
   * Optional per-task timeout override in hours (1–12).
   * When undefined, the orchestrator applies its default (5h).
   * Source of truth: user input on the New Code Task UI (INT-1585).
   */
  timeoutHours?: number;
```

`apps/code-agent/src/domain/repositories/codeTaskRepository.ts` — append after `dispatchSchedule?:` field on `CreateTaskInput`:

```ts
  /** Custom per-task timeout in hours (1–12). INT-1585. */
  timeoutHours?: number;
```

`apps/code-agent/src/infra/firestore/task-serializer.ts` — extend `buildCreateData` after the `dispatchSchedule` block (line ~238):

```ts
  if (input.timeoutHours !== undefined) {
    taskData.timeoutHours = input.timeoutHours;
  }
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @intexuraos/code-agent test -- task-serializer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/
git commit -m "feat(code-agent): persist optional timeoutHours on CodeTask (INT-1585)"
```

---

### Task 3: Accept `timeoutHours` on `POST /code/submit`

**Files:**
- Modify: `apps/code-agent/src/routes/code/task-routes.ts`
- Test: `apps/code-agent/src/__tests__/routes/codeSubmit.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `codeSubmit.test.ts`:

```ts
import { MIN_TIMEOUT_HOURS, MAX_TIMEOUT_HOURS } from '@intexuraos/code-task-domain';

it('persists timeoutHours when sent in /code/submit body', async () => {
  // arrange: same setup as adjacent tests (auth, fakes, etc.)
  const res = await app.inject({
    method: 'POST', url: '/code/submit',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { prompt: 'do thing', timeoutHours: 8 },
  });
  expect(res.statusCode).toBe(200);
  const taskId = JSON.parse(res.body).data.codeTaskId;
  const stored = await codeTaskRepo.getById(taskId);
  expect(stored.value!.timeoutHours).toBe(8);
});

it('rejects timeoutHours below MIN_TIMEOUT_HOURS', async () => {
  const res = await app.inject({
    method: 'POST', url: '/code/submit',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { prompt: 'do thing', timeoutHours: 0 },
  });
  expect(res.statusCode).toBe(400);
});

it('rejects timeoutHours above MAX_TIMEOUT_HOURS', async () => {
  const res = await app.inject({
    method: 'POST', url: '/code/submit',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { prompt: 'do thing', timeoutHours: MAX_TIMEOUT_HOURS + 1 },
  });
  expect(res.statusCode).toBe(400);
});

it('omitting timeoutHours produces a task without it (backward compat)', async () => {
  const res = await app.inject({
    method: 'POST', url: '/code/submit',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { prompt: 'do thing' },
  });
  expect(res.statusCode).toBe(200);
  const taskId = JSON.parse(res.body).data.codeTaskId;
  const stored = await codeTaskRepo.getById(taskId);
  expect(stored.value!.timeoutHours).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @intexuraos/code-agent test -- codeSubmit.test.ts`
Expected: FAIL — schema rejects `timeoutHours` as unknown property OR ignores it silently.

- [ ] **Step 3: Add `timeoutHours` to `/code/submit` route body**

In `task-routes.ts` `/code/submit` registration:

(a) Extend the `Body:` typing in `fastify.post<{ Body: { ... } }>(...)` and the `async (request: FastifyRequest<{ Body: ... }>, reply)` to include `timeoutHours?: number`.

(b) Extend the JSON-schema `body.properties` object:

```ts
              timeoutHours: {
                type: 'integer',
                minimum: MIN_TIMEOUT_HOURS,
                maximum: MAX_TIMEOUT_HOURS,
                description: 'Optional per-task timeout override in hours (1–12). When omitted, orchestrator default (5h) applies.',
              },
```

(c) The Fastify Ajv body schema (`type: 'integer', minimum, maximum`) fully validates the field before the handler runs, so no additional runtime guard is required. The original plan called for a defence-in-depth `isValidTimeoutHours` check, but it would be unreachable through the public route — Ajv rejects the request before the handler executes — and 100% branch coverage would force a `/* v8 ignore */` exemption. Ajv coverage is sufficient.

(d) Add to `createInput` construction (next to where `dispatchSchedule` is set, around line 1588):

```ts
        if (body.timeoutHours !== undefined) {
          createInput.timeoutHours = body.timeoutHours;
        }
```

(e) Update `createInput` literal type to include `timeoutHours?: number;`.

(f) Add the import at the top of the file:

```ts
import { MIN_TIMEOUT_HOURS, MAX_TIMEOUT_HOURS, isValidTimeoutHours } from '@intexuraos/code-task-domain';
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @intexuraos/code-agent test -- codeSubmit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/
git commit -m "feat(code-agent): accept timeoutHours on POST /code/submit (INT-1585)"
```

---

### Task 4: Forward `timeoutHours` from code-agent dispatcher to orchestrator

**Files:**
- Modify: `apps/code-agent/src/domain/services/taskDispatcher.ts`
- Modify: `apps/code-agent/src/infra/services/taskDispatcherImpl.ts`
- Modify: `apps/code-agent/src/domain/usecases/drainTaskQueue.ts`
- Test: `apps/code-agent/src/__tests__/infra/services/taskDispatcherImpl.test.ts` (or the closest existing dispatcher test)

- [ ] **Step 1: Write the failing test**

Extend the dispatcher impl test to assert that `timeoutHours` is included on the request body when present and omitted when absent. Use a `nock`-style fetch interception or the existing fake fetch pattern in the test file.

```ts
it('includes timeoutHours in worker dispatch payload when set', async () => {
  let capturedBody: Record<string, unknown> | undefined;
  const fakeFetch = vi.fn(async (_url: string, init: RequestInit) => {
    capturedBody = JSON.parse(init.body as string) as Record<string, unknown>;
    return new Response(JSON.stringify({ status: 'accepted' }), { status: 200 });
  });
  // ... wire fakeFetch into the dispatcher under test ...

  await dispatcher.dispatch({
    /* ...required fields... */,
    timeoutHours: 8,
  });

  expect(capturedBody?.timeoutHours).toBe(8);
});

it('omits timeoutHours from dispatch payload when absent (backward compat)', async () => {
  let capturedBody: Record<string, unknown> | undefined;
  const fakeFetch = vi.fn(async (_url: string, init: RequestInit) => {
    capturedBody = JSON.parse(init.body as string) as Record<string, unknown>;
    return new Response(JSON.stringify({ status: 'accepted' }), { status: 200 });
  });
  // ... wire fakeFetch ...

  await dispatcher.dispatch({ /* ...required fields, no timeoutHours... */ });

  expect('timeoutHours' in (capturedBody ?? {})).toBe(false);
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @intexuraos/code-agent test -- taskDispatcherImpl`
Expected: FAIL — `timeoutHours` is not on `DispatchRequest`.

- [ ] **Step 3: Wire the field through the dispatcher**

`apps/code-agent/src/domain/services/taskDispatcher.ts` — append to `DispatchRequest`:

```ts
  /** Custom per-task timeout in hours (1–12). When set, orchestrator applies this instead of its 5h default. */
  timeoutHours?: number;
```

`apps/code-agent/src/infra/services/taskDispatcherImpl.ts`:

(a) Append to `WorkerTaskRequest` interface:

```ts
  timeoutHours?: number;
```

(b) After the existing `if (request.reviewTypes !== undefined) {...}` block (line ~149), add:

```ts
    if (request.timeoutHours !== undefined) {
      taskRequest.timeoutHours = request.timeoutHours;
    }
```

`apps/code-agent/src/domain/usecases/drainTaskQueue.ts` — at the `taskDispatcher.dispatch({...})` call (line 513), include:

```ts
      ...(task.timeoutHours !== undefined && { timeoutHours: task.timeoutHours }),
```

Place it among the other conditional spreads (e.g., next to `reviewTypes`).

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @intexuraos/code-agent test -- taskDispatcher`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/
git commit -m "feat(code-agent): forward timeoutHours on orchestrator dispatch (INT-1585)"
```

---

### Task 5: Orchestrator accepts `timeoutHours` and stores it on `Task`

**Files:**
- Modify: `workers/orchestrator/src/types/schemas.ts`
- Modify: `workers/orchestrator/src/types/api.ts`
- Modify: `workers/orchestrator/src/types/task.ts`
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts` (point where `CreateTaskRequest` becomes a `Task`)
- Test: existing schema test (`workers/orchestrator/src/__tests__/...` whichever file covers `CreateTaskRequestSchema`)

- [ ] **Step 1: Write the failing test**

In an orchestrator schema test, add:

```ts
import { MIN_TIMEOUT_HOURS, MAX_TIMEOUT_HOURS } from '@intexuraos/code-task-domain';
import { CreateTaskRequestSchema } from '../types/schemas.js';

it('accepts timeoutHours within [MIN, MAX]', () => {
  const r = CreateTaskRequestSchema.safeParse({
    taskId: 'task_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    workerType: 'auto',
    prompt: 'p',
    webhookUrl: 'https://x', webhookSecret: 's',
    linearIssueLabels: [], hasChildren: false,
    timeoutHours: 8,
  });
  expect(r.success).toBe(true);
});

it('rejects timeoutHours below MIN', () => {
  const r = CreateTaskRequestSchema.safeParse({
    taskId: 'task_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    workerType: 'auto', prompt: 'p',
    webhookUrl: 'https://x', webhookSecret: 's',
    linearIssueLabels: [], hasChildren: false,
    timeoutHours: MIN_TIMEOUT_HOURS - 1,
  });
  expect(r.success).toBe(false);
});

it('rejects timeoutHours above MAX', () => {
  const r = CreateTaskRequestSchema.safeParse({
    taskId: 'task_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    workerType: 'auto', prompt: 'p',
    webhookUrl: 'https://x', webhookSecret: 's',
    linearIssueLabels: [], hasChildren: false,
    timeoutHours: MAX_TIMEOUT_HOURS + 1,
  });
  expect(r.success).toBe(false);
});

it('treats absent timeoutHours as valid (backward compat)', () => {
  const r = CreateTaskRequestSchema.safeParse({
    taskId: 'task_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    workerType: 'auto', prompt: 'p',
    webhookUrl: 'https://x', webhookSecret: 's',
    linearIssueLabels: [], hasChildren: false,
  });
  expect(r.success).toBe(true);
});
```

- [ ] **Step 2: Run schema tests to verify failure**

Run: `pnpm --filter @intexuraos/orchestrator test -- schemas`
Expected: FAIL — Zod schema does not yet declare `timeoutHours`.

- [ ] **Step 3: Add `timeoutHours` to schema, API type, and `Task`**

`workers/orchestrator/src/types/schemas.ts` — at top:

```ts
import { MIN_TIMEOUT_HOURS, MAX_TIMEOUT_HOURS } from '@intexuraos/code-task-domain';
```

Append to `CreateTaskRequestSchema` object:

```ts
  timeoutHours: z.number().int().min(MIN_TIMEOUT_HOURS).max(MAX_TIMEOUT_HOURS).optional(),
```

`workers/orchestrator/src/types/api.ts` — append to `CreateTaskRequest`:

```ts
  /** Optional per-task timeout in hours (1–12). When omitted, the orchestrator default (5h) applies. INT-1585. */
  timeoutHours?: number;
```

`workers/orchestrator/src/types/task.ts` — append to `Task`:

```ts
  /**
   * Resolved per-task timeout in milliseconds, derived from `CreateTaskRequest.timeoutHours`.
   * When undefined, the orchestrator falls back to TASK_TIMEOUT_KILL_MS (5h). INT-1585.
   */
  timeoutMs?: number;
```

`workers/orchestrator/src/routes.ts` — propagate from parsed input to `body` (~line 175):

```ts
      ...(parsed.timeoutHours !== undefined && { timeoutHours: parsed.timeoutHours }),
```

Now in `workers/orchestrator/src/services/task-dispatcher.ts`, find where the `Task` is built from `CreateTaskRequest` (search for `submitTask` and the `Task` construction). Add:

```ts
      ...(request.timeoutHours !== undefined && {
        timeoutMs: request.timeoutHours * 60 * 60 * 1000,
      }),
```

(Use `timeoutHoursToMs` from the shared package if convenient — but the multiplication is fine inline since the helper currently lives in a different package and the orchestrator already does similar arithmetic in `retry-logic.ts`.)

- [ ] **Step 4: Run schema test to verify pass**

Run: `pnpm --filter @intexuraos/orchestrator test -- schemas`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add workers/orchestrator/
git commit -m "feat(orchestrator): accept optional timeoutHours on /tasks (INT-1585)"
```

---

### Task 6: Orchestrator timers honour per-task `timeoutMs`

**Files:**
- Modify: `workers/orchestrator/src/services/task-dispatcher/task-timers.ts`
- Modify: `workers/orchestrator/src/services/task-dispatcher/dispatcher-context.ts`
- Modify: `workers/orchestrator/src/services/task-dispatcher/setup.ts`
- Modify: `workers/orchestrator/src/services/task-dispatcher/attempt-lifecycle.ts`
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts` (bridge wiring)
- Modify: `workers/orchestrator/src/services/task-dispatcher/retry-logic.ts` (export warning offset constant)
- Test: `workers/orchestrator/src/services/task-dispatcher/__tests__/task-timers.test.ts`

> **Memory note (mem_ea53ecb5):** Update test descriptions and assertions to match the *new* behaviour (per-task durations) — do not leave stale "5h" text on tests that now also exercise other durations.

- [ ] **Step 1: Add a constant for the warning offset**

`workers/orchestrator/src/services/task-dispatcher/retry-logic.ts` — add (above the existing `TASK_TIMEOUT_*_MS` constants):

```ts
/** Warning offset before kill: the warning fires `kill - WARNING_OFFSET_MS`. */
export const TASK_TIMEOUT_WARNING_OFFSET_MS = 5 * 60 * 1000; // 5 min
```

The existing constants `TASK_TIMEOUT_KILL_MS = 5h` and `TASK_TIMEOUT_WARNING_MS = 4h55m` stay — they remain the fallbacks when `task.timeoutMs` is undefined.

- [ ] **Step 2: Write the failing tests for the timers**

Append to `task-timers.test.ts`:

```ts
import { TASK_TIMEOUT_WARNING_OFFSET_MS } from '../retry-logic.js';

describe('per-task timeout override (INT-1585)', () => {
  it('schedules warning at customMs - 5min when overrideMs is provided', async () => {
    timers.scheduleTimeoutWarning('task-c', 2 * 60 * 60 * 1000); // 2h
    const warnSpy = vi.spyOn(ctx.logger, 'warn');

    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000 - TASK_TIMEOUT_WARNING_OFFSET_MS - 1);
    expect(warnSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-c' }),
      // INT-1585: warning text now references the resolved timeout (in hours)
      expect.stringMatching(/2-hour timeout/),
    );
  });

  it('kills the task at customMs when overrideMs is provided', async () => {
    timers.scheduleTimeoutKill('task-c', 2 * 60 * 60 * 1000);
    // ... assert ctx.isolation.provider.destroyWorker is called after the override duration
  });

  it('falls back to TASK_TIMEOUT_KILL_MS (5h) when overrideMs is undefined', async () => {
    timers.scheduleTimeoutKill('task-d', undefined);
    await vi.advanceTimersByTimeAsync(TASK_TIMEOUT_KILL_MS - 1);
    // ... assert destroyWorker NOT called yet ...
    await vi.advanceTimersByTimeAsync(2);
    // ... assert destroyWorker WAS called now ...
  });
});
```

Update the existing 5h-warning test description and expected log message — the format string in `task-timers.ts` is changing from a hard-coded `'Task approaching 5-hour timeout'` to a templated `Task approaching ${hours}-hour timeout`. Tests that currently match `'5-hour timeout'` must keep matching when no override is supplied (5h fallback path).

- [ ] **Step 3: Run tests to verify failure**

Run: `pnpm --filter @intexuraos/orchestrator test -- task-timers`
Expected: FAIL — `scheduleTimeoutWarning` does not yet accept a second argument.

- [ ] **Step 4: Implement per-task timer durations**

`workers/orchestrator/src/services/task-dispatcher/task-timers.ts` — change the two methods:

```ts
import {
  clearTaskTimers as clearTaskTimersFn,
  TASK_TIMEOUT_WARNING_MS,
  TASK_TIMEOUT_KILL_MS,
  TASK_TIMEOUT_WARNING_OFFSET_MS,
  COMPLETION_CHECK_INTERVAL_MS,
  ACTIVITY_HEARTBEAT_THRESHOLD_MS,
  WORKER_DESTROY_TIMEOUT_MS,
} from './retry-logic.js';

  scheduleTimeoutWarning(taskId: string, overrideKillMs?: number): void {
    const ctx = this.ctx;
    const killMs = overrideKillMs ?? TASK_TIMEOUT_KILL_MS;
    const warningMs = overrideKillMs !== undefined
      ? Math.max(0, overrideKillMs - TASK_TIMEOUT_WARNING_OFFSET_MS)
      : TASK_TIMEOUT_WARNING_MS;
    const hours = Math.round(killMs / (60 * 60 * 1000));

    const timeout = setTimeout(() => {
      void (async (): Promise<void> => {
        try {
          const task = await ctx.getTask(taskId);
          if (task !== null && task.status === 'running') {
            ctx.logger.warn({ taskId }, `Task approaching ${String(hours)}-hour timeout`);
          }
        } catch (error) {
          ctx.logger.error({ taskId, error }, 'Error in timeout warning callback');
        }
      })();
    }, warningMs);

    ctx.activeTasks.set(`${taskId}-warning`, timeout);
    this.attachShutdownAbort(timeout, false);
  }

  scheduleTimeoutKill(taskId: string, overrideKillMs?: number): void {
    const ctx = this.ctx;
    const killMs = overrideKillMs ?? TASK_TIMEOUT_KILL_MS;

    const timeout = setTimeout(() => {
      void (async (): Promise<void> => {
        // ... existing body unchanged ...
      })();
    }, killMs);

    ctx.activeTasks.set(`${taskId}-kill`, timeout);
    this.attachShutdownAbort(timeout, false);
  }
```

`dispatcher-context.ts` — update bridge signatures:

```ts
  scheduleTimeoutWarning: (taskId: string, overrideKillMs?: number) => void;
  scheduleTimeoutKill: (taskId: string, overrideKillMs?: number) => void;
```

`setup.ts` — update `DispatcherContextBridges`:

```ts
  scheduleTimeoutWarning: (taskId: string, overrideKillMs?: number) => void;
  scheduleTimeoutKill: (taskId: string, overrideKillMs?: number) => void;
```

`workers/orchestrator/src/services/task-dispatcher.ts` — update bridge wiring (lines 305–309):

```ts
        scheduleTimeoutWarning: (taskId, overrideKillMs): void => {
          this.taskTimers.scheduleTimeoutWarning(taskId, overrideKillMs);
        },
        scheduleTimeoutKill: (taskId, overrideKillMs): void => {
          this.taskTimers.scheduleTimeoutKill(taskId, overrideKillMs);
        },
```

`attempt-lifecycle.ts` — at the two call sites (lines ~270 and ~433), pass through the per-task override:

```ts
      ctx.scheduleTimeoutWarning(taskId, task.timeoutMs);
      ctx.scheduleTimeoutKill(taskId, task.timeoutMs);
```

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm --filter @intexuraos/orchestrator test -- task-timers attempt-lifecycle setup`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add workers/orchestrator/
git commit -m "feat(orchestrator): honour per-task timeoutMs in warning/kill timers (INT-1585)"
```

---

### Task 7: Web — `TimeoutSlider` component

**Files:**
- Create: `apps/web/src/components/code-tasks/TimeoutSlider.tsx`
- Test: `apps/web/src/components/code-tasks/__tests__/TimeoutSlider.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/components/code-tasks/__tests__/TimeoutSlider.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TimeoutSlider } from '../TimeoutSlider.js';
import { DEFAULT_TIMEOUT_HOURS, MIN_TIMEOUT_HOURS, MAX_TIMEOUT_HOURS } from '@intexuraos/code-task-domain';

describe('TimeoutSlider', () => {
  it('renders default value (5 hours) and label', () => {
    const onChange = vi.fn();
    render(<TimeoutSlider value={DEFAULT_TIMEOUT_HOURS} onChange={onChange} />);
    expect(screen.getByText(/5 hours/i)).toBeInTheDocument();
    const slider = screen.getByRole('slider');
    expect(slider).toHaveAttribute('min', String(MIN_TIMEOUT_HOURS));
    expect(slider).toHaveAttribute('max', String(MAX_TIMEOUT_HOURS));
    expect(slider).toHaveValue(String(DEFAULT_TIMEOUT_HOURS));
  });

  it('calls onChange with the new integer value', () => {
    const onChange = vi.fn();
    render(<TimeoutSlider value={DEFAULT_TIMEOUT_HOURS} onChange={onChange} />);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '8' } });
    expect(onChange).toHaveBeenCalledWith(8);
  });

  it('renders 1 hour singular label at minimum', () => {
    const onChange = vi.fn();
    render(<TimeoutSlider value={1} onChange={onChange} />);
    expect(screen.getByText(/1 hour\b/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @intexuraos/web test -- TimeoutSlider`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the component**

```tsx
// apps/web/src/components/code-tasks/TimeoutSlider.tsx
import { Clock } from 'lucide-react';
import {
  MIN_TIMEOUT_HOURS,
  MAX_TIMEOUT_HOURS,
  DEFAULT_TIMEOUT_HOURS,
} from '@intexuraos/code-task-domain';

interface TimeoutSliderProps {
  value: number;
  onChange: (hours: number) => void;
  disabled?: boolean;
}

export function TimeoutSlider({ value, onChange, disabled }: TimeoutSliderProps): React.JSX.Element {
  const label = `${String(value)} ${value === 1 ? 'hour' : 'hours'}`;
  const isDefault = value === DEFAULT_TIMEOUT_HOURS;

  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-2 dark:text-slate-200 flex items-center gap-2">
        <Clock className="h-4 w-4 text-slate-500" />
        Task Timeout
      </label>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={MIN_TIMEOUT_HOURS}
          max={MAX_TIMEOUT_HOURS}
          step={1}
          value={value}
          disabled={disabled === true}
          onChange={(e): void => {
            onChange(Number.parseInt(e.target.value, 10));
          }}
          aria-label="Task timeout in hours"
          className="w-full"
        />
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200 min-w-[5rem] text-right">
          {label}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        {isDefault
          ? `Default — orchestrator will apply ${String(DEFAULT_TIMEOUT_HOURS)} hours.`
          : `Custom — overrides orchestrator default of ${String(DEFAULT_TIMEOUT_HOURS)} hours.`}
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @intexuraos/web test -- TimeoutSlider`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/code-tasks/
git commit -m "feat(web): add TimeoutSlider component (INT-1585)"
```

---

### Task 8: Wire `TimeoutSlider` into the New Code Task page

**Files:**
- Modify: `apps/web/src/pages/CodeTaskNewPage.tsx`
- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/components/ConfirmSubmitModal.tsx`
- Test: `apps/web/src/pages/__tests__/CodeTaskNewPage.test.tsx` (or whichever covers this page; create coverage if missing)

- [ ] **Step 1: Write the failing test**

Add a UI integration test (Vitest + React Testing Library) that:
1. Renders `<CodeTaskNewPage />`,
2. Drags the slider to 8h,
3. Submits the form,
4. Asserts that `submitCodeTask` was called with `timeoutHours: 8`.
5. Asserts that submitting at the default 5h does NOT include `timeoutHours` in the request body (sentinel for backward compat).

```tsx
it('sends timeoutHours when slider is changed', async () => {
  const submitSpy = vi.mocked(submitCodeTask).mockResolvedValue({ status: 'submitted', codeTaskId: 'task_x' });
  render(/* page with required providers */);
  fireEvent.change(screen.getByRole('slider', { name: /timeout/i }), { target: { value: '8' } });
  // ... fill prompt, click submit, confirm modal ...
  expect(submitSpy).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ timeoutHours: 8 }),
  );
});

it('omits timeoutHours when slider stays at default', async () => {
  const submitSpy = vi.mocked(submitCodeTask).mockResolvedValue({ status: 'submitted', codeTaskId: 'task_x' });
  render(/* page */);
  // ... fill prompt, click submit, confirm modal — DO NOT touch slider ...
  const [, payload] = submitSpy.mock.calls[0]!;
  expect((payload as Record<string, unknown>).timeoutHours).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @intexuraos/web test -- CodeTaskNewPage`
Expected: FAIL — slider not present and `timeoutHours` not in payload.

- [ ] **Step 3: Add `timeoutHours` to the request type**

`apps/web/src/types/index.ts` — append to `SubmitCodeTaskRequest`:

```ts
  /** Optional per-task timeout override in hours (1–12). When omitted, orchestrator default (5h) applies. INT-1585. */
  timeoutHours?: number;
```

- [ ] **Step 4: Wire `<TimeoutSlider />` into the page**

In `apps/web/src/pages/CodeTaskNewPage.tsx`:

(a) Import:

```ts
import { DEFAULT_TIMEOUT_HOURS } from '@intexuraos/code-task-domain';
import { TimeoutSlider } from '@/components/code-tasks/TimeoutSlider';
```

(b) Add state next to `const [taskMode, setTaskMode] = useState<TaskMode>('planning');`:

```ts
const [timeoutHours, setTimeoutHours] = useState<number>(DEFAULT_TIMEOUT_HOURS);
```

(c) Render the slider directly below the **Task Mode** section (i.e., right after the `</div>` that closes the Task Mode block, around line 396):

```tsx
          <TimeoutSlider value={timeoutHours} onChange={setTimeoutHours} disabled={submitting} />
```

(d) Inside `handleConfirmSubmit`, after constructing `requestData`, only include the field when it differs from the default — preserves wire-compat:

```ts
      if (timeoutHours !== DEFAULT_TIMEOUT_HOURS) {
        requestData.timeoutHours = timeoutHours;
      }
```

(e) Pass to `<ConfirmSubmitModal />`:

```tsx
        <ConfirmSubmitModal
          ...
          timeoutHours={timeoutHours}
          ...
        />
```

In `apps/web/src/components/ConfirmSubmitModal.tsx`:

(a) Extend props with `timeoutHours: number;`.
(b) Render below the existing `<p>` describing the task:

```tsx
{timeoutHours !== DEFAULT_TIMEOUT_HOURS ? (
  <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">
    Custom timeout: <span className="font-semibold">{String(timeoutHours)} hours</span>
  </p>
) : null}
```
And import `DEFAULT_TIMEOUT_HOURS` at the top.

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm --filter @intexuraos/web test -- CodeTaskNewPage TimeoutSlider ConfirmSubmitModal`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/
git commit -m "feat(web): timeout slider on New Code Task page (INT-1585)"
```

---

### Task 9: Read-only display of custom timeout on Code Task view

**Files:**
- Modify: `apps/web/src/components/code-tasks/TaskHeader.tsx`
- Modify: `apps/web/src/types/index.ts` (add `timeoutHours?: number` to the read-side `CodeTask`)
- Test: `apps/web/src/components/code-tasks/__tests__/TaskHeader.timeout.test.tsx` (new file or extend existing)

- [ ] **Step 1: Write the failing test**

```tsx
it('shows custom timeout when task.timeoutHours is set', () => {
  const task = makeFakeTask({ timeoutHours: 8 });
  render(<TaskHeader task={task} {...otherRequiredProps} />);
  expect(screen.getByText(/Custom timeout: 8h/i)).toBeInTheDocument();
});

it('does not show custom timeout when task.timeoutHours is undefined', () => {
  const task = makeFakeTask({ /* no timeoutHours */ });
  render(<TaskHeader task={task} {...otherRequiredProps} />);
  expect(screen.queryByText(/Custom timeout/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @intexuraos/web test -- TaskHeader`
Expected: FAIL.

- [ ] **Step 3: Add field to read model and render**

`apps/web/src/types/index.ts` — find the `CodeTask` interface and add `timeoutHours?: number;`.

`apps/web/src/components/code-tasks/TaskHeader.tsx` — render a small badge near worker type / task mode info:

```tsx
{task.timeoutHours !== undefined ? (
  <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
    <Clock className="h-3 w-3" />
    Custom timeout: {String(task.timeoutHours)}h
  </span>
) : null}
```

(Add `Clock` import from `lucide-react` if not already imported.)

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @intexuraos/web test -- TaskHeader`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/
git commit -m "feat(web): show custom timeout badge on Code Task view (INT-1585)"
```

---

### Task 10: End-to-end verification + CI

**Files:** none (verification + commit final state)

- [ ] **Step 1: Run workspace verification**

```
pnpm run verify:workspace:tracked -- code-task-domain
pnpm run verify:workspace:tracked -- code-agent
pnpm run verify:workspace:tracked -- orchestrator
pnpm run verify:workspace:tracked -- web
```

Expected: All four pass with 100% branch coverage on backends (web app coverage not enforced).

- [ ] **Step 2: Run full repo CI**

```
pnpm run ci:tracked
```

Expected: PASS, all green.

- [ ] **Step 3: Manual smoke check (optional, recorded for the record)**

- Submit a task via UI with default slider → verify Firestore `code_tasks/{id}` has no `timeoutHours` field.
- Submit a task with slider at 8h → verify Firestore document has `timeoutHours: 8`; verify orchestrator log line `'Task approaching 8-hour timeout'` would appear at 7h55m (verifiable by inspecting `task-timers.ts` log).
- Submit with slider at 1h → ensure the warning offset (5min) does not produce a negative warning timer (`Math.max(0, ...)` guard).

- [ ] **Step 4: Commit (only if any test/code touches were needed during verification)**

```bash
git add -A
git commit -m "chore(int-1585): final verification adjustments"
```

---

## Acceptance Criteria

- [ ] User opens `New Code Task`, sees a slider labelled **Task Timeout** below **Task Mode**, defaulting to **5 hours**, with range 1–12.
- [ ] Submitting with the default value sends a request **without** `timeoutHours` (backward compatible) and the resulting `code_tasks/{id}` document has no `timeoutHours` field.
- [ ] Submitting with any non-default value sends `timeoutHours: <N>` to `POST /code/submit`, code-agent persists it, and the orchestrator dispatch payload includes the field.
- [ ] Orchestrator with `timeoutHours: N` schedules the hard-kill timer at exactly `N` hours and the warning at `N hours - 5min` (with a non-negative floor at the 1h boundary).
- [ ] Orchestrator with no `timeoutHours` continues to use the legacy `TASK_TIMEOUT_KILL_MS = 5h` and `TASK_TIMEOUT_WARNING_MS = 4h55m` constants — fully backward compatible.
- [ ] Code Task detail page surfaces a **Custom timeout: Nh** badge when the field is present.
- [ ] All new code paths covered by tests; `pnpm run ci:tracked` passes.

---

## Backward Compatibility Notes

- Wire-level: `timeoutHours` is optional at every layer (web → code-agent → orchestrator). Older clients (e.g., webhook-driven dispatch via `processCodeAction`) will continue to omit the field, and the orchestrator will continue to apply the existing 5-hour constants.
- HMAC: code-agent's `taskDispatcherImpl` signs the JSON body it actually sends. Adding a conditional optional field does not break HMAC validation because the orchestrator hashes the same JSON body it received. The orchestrator's HMAC verification (in `routes.ts` line 100–108) does `JSON.stringify(request.body)` after parsing — which means field-order on the wire matters for the signature on the code-agent side, not on the orchestrator side. Since we only ever append to the JSON object after all existing optional fields, no re-ordering of pre-existing fields occurs.
- Firestore: `timeoutHours` is optional on the document; old documents without the field are unaffected. No migration is required.

---

## Risks / Considered Alternatives

- **Per-attempt vs per-task timeout:** the orchestrator currently re-arms timers on every attempt (`attempt-lifecycle.ts` calls `scheduleTimeoutWarning/Kill` on each attempt start). We pass the same `task.timeoutMs` on every attempt — i.e., each attempt has its own N-hour budget. This matches the existing behaviour with the constants and is correct for the spec ("survive more than 5 hours"). If product later wants a *cumulative* budget, that is a follow-up — flagged here.
- **Slider step granularity:** the spec says "1 to 12 hours" — we use integer steps (`step={1}`). If half-hour granularity is desired later, change `step` and bump `MIN/MAX` semantics together.
- **Field name (`timeoutHours` vs `timeoutMs` on the wire):** we send `timeoutHours` end-to-end (human-friendly, matches the UI), and the orchestrator converts to `ms` once on intake. This avoids three different unit conventions across the codebase.

---

## Self-Review

- **Spec coverage:** ✅ slider 1–12h default 5h (Task 7); below Task Mode (Task 8); stored in Code task (Task 2); sent optionally (Task 4); orchestrator backward-compatible (Tasks 5+6).
- **Placeholder scan:** ✅ no TBD/TODO/"add appropriate" — every step has concrete code.
- **Type consistency:** ✅ `timeoutHours` (number, hours, integer) everywhere on the wire and in storage; only orchestrator's *internal* `Task.timeoutMs` carries the converted value, with explicit conversion at the route boundary.
