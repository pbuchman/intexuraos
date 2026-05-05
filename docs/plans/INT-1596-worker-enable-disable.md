# Worker Enable/Disable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users enable and disable configured code workers from the worker status dropdown and Code Settings, while ensuring disabled workers never receive dispatch, message, health-probe, or cancellation calls.

**Architecture:** `apps/code-agent` remains the source of truth for worker configuration in `code_worker_settings`; the existing `PATCH /code/worker-settings/workers/:name` endpoint writes `enabled`. Worker status endpoints expose disabled workers as a first-class status so `apps/web` can render a yellow disabled state without inferring it from health failures. A Firestore migration backfills missing `enabled` fields to `true` while preserving existing disabled workers.

**Tech Stack:** TypeScript, Fastify route schemas, Firestore migrations, React/Vite, TailwindCSS, Vitest.

---

## Parallel Breakdown

This is a complex task with two independent child issues. Implementation must use subagents and the subagents can work in parallel because the contracts below define the shared API shape.

| Child | Boundary | Owns | Exposes / Consumes |
| --- | --- | --- | --- |
| [INT-1597](https://linear.app/pbuchman/issue/INT-1597/implement-worker-enabled-state-in-code-agent-dispatch-and-status-apis) | `apps/code-agent` + `migrations` | Firestore defaults/backfill, worker status response shape, dispatch filtering, route tests | Exposes `enabled: boolean` and `status: 'disabled'` through worker status endpoints; preserves `PATCH /code/worker-settings/workers/:name` for writes |
| [INT-1598](https://linear.app/pbuchman/issue/INT-1598/expose-worker-enable-toggles-and-disabled-status-colors-in-web-ui) | `apps/web` | Header dropdown switches, Code Settings switches, status colors, web tests | Consumes the status contract from INT-1597 and writes `{ enabled: boolean }` through the existing worker settings API |

No child issue depends on another child issue being completed first. Web can update its TypeScript contract and tests against the documented backend response shape while code-agent implements the endpoint contract independently.

## Endpoint Changes

**Modified**

- `GET /code/workers/status`
  - Add `enabled: boolean` to every worker item.
  - Add `disabled` to the `status` enum.
  - Return disabled workers without probing them.
- `POST /code/workers/refresh-status`
  - Add `enabled: boolean` to every worker item.
  - Add `disabled` to the `status` enum.
  - Probe only enabled workers.
- `PATCH /code/worker-settings/workers/:name`
  - Existing endpoint already accepts `enabled`; add/confirm tests that toggling does not require credential fields and preserves existing secrets.

**Created**

- No HTTP endpoints.

**Removed**

- No HTTP endpoints.

**Unchanged**

- `GET /code/worker-settings`
- `POST /code/worker-settings/workers`
- `DELETE /code/worker-settings/workers/:name`
- `PUT /code/worker-settings/priority`
- `POST /code/worker-settings/workers/:name/test`

## State Matrix

| State | Stored Worker `enabled` | Probed | Dispatch Candidate | Worker Status Item | UI Color |
| --- | --- | --- | --- | --- | --- |
| Enabled + healthy | `true` | Yes | Yes | `enabled: true`, `healthy: true`, `status: 'healthy'` | Green |
| Enabled + unreachable/auth/tunnel issue | `true` | Yes | No after health failure | `enabled: true`, `healthy: false`, status from health probe | Red |
| Disabled | `false` | No | No | `enabled: false`, `healthy: false`, `status: 'disabled'`, `details.reason: 'disabled'` | Yellow |
| Missing historical field | missing | Treated as enabled | Yes after successful health probe | Read as `enabled: true`; migration writes `enabled: true` | Green/red based on health |

This matrix incorporates the execution-memory warning for non-standard states: disabled, unreachable, unauthorized, and missing historical fields must all update external UI state consistently, not only the successful dispatch path.

## Task 1: Code-Agent Contract And Backfill

**Files:**

- Modify: `apps/code-agent/src/domain/models/workerSettings.ts`
- Modify: `apps/code-agent/src/domain/services/taskDispatcher.ts`
- Modify: `apps/code-agent/src/infra/firestore/workerSettingsRepository.ts`
- Modify: `apps/code-agent/src/routes/code/task-routes.ts`
- Modify: `apps/code-agent/src/domain/usecases/sendTaskMessage.ts`
- Test: `apps/code-agent/src/__tests__/infra/firestore/workerSettingsRepository.test.ts`
- Test: `apps/code-agent/src/__tests__/routes/codeRoutes.test.ts`
- Test: `apps/code-agent/src/__tests__/domain/usecases/drainTaskQueue.test.ts`
- Test: `apps/code-agent/src/__tests__/domain/usecases/drainRetryQueue.test.ts`
- Create: `migrations/101_backfill-code-worker-settings-enabled.mjs`
- Test: `migrations/__tests__/101-backfill-code-worker-settings-enabled.test.ts`

- [ ] **Step 1: Write repository tests for historical missing `enabled`**

Add tests proving old worker records without `enabled` are returned as enabled, and updating an unrelated field writes `enabled: true` when the stored field was missing.

```ts
it('defaults historical workers without enabled to true', async () => {
  await firestore.collection('code_worker_settings').doc('user-1').set({
    userId: 'user-1',
    workers: [{
      name: 'home-dev',
      url: 'https://home.example.com',
      cfAccessClientId: encryptToken('client-id'),
      cfAccessClientSecret: encryptToken('client-secret'),
      dispatchSigningSecret: encryptToken('dispatch-secret'),
    }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const result = await repo.getSettings('user-1');

  expect(result.ok).toBe(true);
  if (!result.ok || result.value === null) throw new Error('expected settings');
  expect(result.value.workers[0]?.enabled).toBe(true);
});
```

Run: `pnpm --filter code-agent test -- src/__tests__/infra/firestore/workerSettingsRepository.test.ts -t "historical workers"`

Expected: FAIL until `EncryptedWorkerConfig.enabled` is optional and `decryptWorkerConfig()` defaults missing values to `true`.

- [ ] **Step 2: Implement repository defaulting**

Change the stored type to allow historical docs and default reads/updates to enabled:

```ts
interface EncryptedWorkerConfig {
  name: string;
  url: string;
  cfAccessClientId: string;
  cfAccessClientSecret: string;
  dispatchSigningSecret: string;
  enabled?: boolean;
  lastTestedAt?: string;
  testStatus?: 'success' | 'failure';
  testMessage?: string;
}

// In decryptWorkerConfig
enabled: encrypted.enabled !== false,

// In updateWorker
enabled: config.enabled ?? existingWorker.enabled ?? true,
```

Run: `pnpm --filter code-agent test -- src/__tests__/infra/firestore/workerSettingsRepository.test.ts`

Expected: PASS.

- [ ] **Step 3: Write worker status route tests for disabled workers**

Add route tests for both cached and refresh endpoints:

```ts
it('returns disabled workers as disabled and does not probe them from cached status', async () => {
  mockGetSettings.mockResolvedValue(ok({
    userId: 'test-user-id',
    workers: [
      enabledWorker({ name: 'home-dev' }),
      { ...enabledWorker({ name: 'mac-dev' }), enabled: false },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
  mockGetHealthStatuses.mockResolvedValue(ok({}));
  mockProbeAllWorkers.mockResolvedValue({
    'home-dev': healthyState(),
  });

  const response = await server.inject({
    method: 'GET',
    url: '/code/workers/status',
    headers: { authorization: 'Bearer test-token' },
  });

  expect(response.statusCode).toBe(200);
  expect(mockProbeAllWorkers).toHaveBeenCalledWith([expect.objectContaining({ name: 'home-dev' })]);
  const body = JSON.parse(response.body);
  expect(body.data.workers[1]).toMatchObject({
    name: 'mac-dev',
    enabled: false,
    healthy: false,
    status: 'disabled',
    details: { reason: 'disabled' },
    checkedAt: null,
    stale: false,
  });
});
```

Run: `pnpm --filter code-agent test -- src/__tests__/routes/codeRoutes.test.ts -t "disabled workers"`

Expected: FAIL until route schemas and mapping include disabled status.

- [ ] **Step 4: Implement disabled worker status mapping**

In both worker status endpoints:

- Extend response schema enum to include `disabled`.
- Add `enabled: { type: 'boolean' }` and require it in each worker item.
- Build `enabledWorkers = settings.workers.filter((w) => w.enabled)`.
- Check stale/missing health only against enabled workers.
- Call `workerHealthProbe.probeAllWorkers(enabledWorkers)`.
- Return a synthetic disabled row before reading cached/probed health:

```ts
if (w.enabled !== true) {
  return {
    name: w.name,
    url: w.url,
    priority: index + 1,
    enabled: false,
    healthy: false,
    status: 'disabled' as const,
    details: { reason: 'disabled' },
    checkedAt: null,
    stale: false,
  };
}
```

Run: `pnpm --filter code-agent test -- src/__tests__/routes/codeRoutes.test.ts`

Expected: PASS.

- [ ] **Step 5: Audit task-specific worker calls**

Keep new-task dispatch filtering as-is where enabled workers are already used, but fix task-specific calls so they never fall back to a different enabled worker when the task's recorded worker is disabled.

In `sendTaskMessage.ts`, replace fallback selection:

```ts
const worker = enabledWorkers.find((w) => w.name === task.workerLocation) ?? enabledWorkers[0];
```

with exact-worker selection:

```ts
const worker = enabledWorkers.find((w) => w.name === task.workerLocation);
if (worker === undefined) {
  return err({
    code: 'worker_not_configured',
    message: `Worker '${task.workerLocation}' is disabled or not configured`,
  });
}
```

Confirm cancellation paths already skip disabled workers by passing `undefined` credentials to `cancelOnWorker`.

Run: `pnpm --filter code-agent test -- src/__tests__/domain/usecases/sendTaskMessage.test.ts src/__tests__/domain/usecases/cancelTask.test.ts`

Expected: PASS after adding or updating tests for disabled task-location handling.

- [ ] **Step 6: Add queue and retry dispatch assertions**

Add tests proving disabled workers are excluded from dispatch credentials in:

- `drainTaskQueue`
- `drainRetryQueue`
- any existing retry-entry dispatch helper that builds worker credentials

The assertion should inspect the `taskDispatcher.dispatch` payload:

```ts
expect(taskDispatcher.dispatch).toHaveBeenCalledWith(expect.objectContaining({
  workerCredentials: {
    workers: [expect.objectContaining({ name: 'home-dev' })],
  },
}));
expect(taskDispatcher.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({
  workerCredentials: expect.objectContaining({
    workers: expect.arrayContaining([expect.objectContaining({ name: 'mac-dev' })]),
  }),
}));
```

Run: `pnpm --filter code-agent test -- src/__tests__/domain/usecases/drainTaskQueue.test.ts src/__tests__/domain/usecases/drainRetryQueue.test.ts`

Expected: PASS.

- [ ] **Step 7: Add the immutable backfill migration**

Create `migrations/101_backfill-code-worker-settings-enabled.mjs`:

```js
export const metadata = {
  id: '101',
  name: 'backfill-code-worker-settings-enabled',
  description: 'Backfill enabled=true for historical code worker settings without an enabled field',
  createdAt: '2026-05-05',
};

export async function up(context) {
  const snapshot = await context.firestore.collection('code_worker_settings').get();
  const updates = [];
  const now = new Date().toISOString();

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const workers = Array.isArray(data.workers) ? data.workers : [];
    let changed = false;
    const nextWorkers = workers.map((worker) => {
      if (
        worker !== null &&
        typeof worker === 'object' &&
        !Object.prototype.hasOwnProperty.call(worker, 'enabled')
      ) {
        changed = true;
        return { ...worker, enabled: true };
      }
      return worker;
    });

    if (changed) {
      updates.push(doc.ref.update({ workers: nextWorkers, updatedAt: now }));
    }
  }

  await Promise.all(updates);
  console.log(`  Backfilled enabled=true on ${String(updates.length)} code_worker_settings document(s)`);
}
```

Add tests that cover missing field, existing `false`, existing `true`, and an empty/malformed workers array.

Run: `pnpm --filter migrations test -- 101-backfill-code-worker-settings-enabled`

Expected: PASS.

- [ ] **Step 8: Verify code-agent boundary**

Run:

```bash
pnpm --filter code-agent test -- src/__tests__/infra/firestore/workerSettingsRepository.test.ts src/__tests__/routes/codeRoutes.test.ts
pnpm --filter code-agent test -- src/__tests__/domain/usecases/drainTaskQueue.test.ts src/__tests__/domain/usecases/drainRetryQueue.test.ts
pnpm --filter migrations test -- 101-backfill-code-worker-settings-enabled
```

Expected: all selected tests pass.

## Task 2: Web Toggle UX And Colors

**Files:**

- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/hooks/useCodeTasks.ts`
- Modify: `apps/web/src/components/Header.tsx`
- Modify: `apps/web/src/components/workers/WorkerRow.tsx`
- Test: `apps/web/src/components/__tests__/Header.test.tsx`
- Test: `apps/web/src/pages/__tests__/WorkerSettingsPage.test.tsx`
- Test: `apps/web/src/hooks/__tests__/useCodeTasks.test.ts`
- Test: `apps/web/src/services/__tests__/workerSettingsApi.test.ts`

- [ ] **Step 1: Update web types**

Change worker status types:

```ts
export type WorkerStatusTag =
  | 'healthy'
  | 'orchestrator-unreachable'
  | 'tunnel-down'
  | 'unknown'
  | 'disabled';

export interface WorkerStatus {
  name: string;
  url: string;
  priority: number;
  enabled: boolean;
  healthy: boolean;
  status: WorkerStatusTag;
  details: WorkerStatusDetails | null;
  checkedAt: string | null;
  stale: boolean;
}
```

Run: `pnpm --filter web test -- useCodeTasks`

Expected: FAIL until fixtures include `enabled`.

- [ ] **Step 2: Add toggle write support to `useWorkersStatus`**

In `apps/web/src/hooks/useCodeTasks.ts`, import `updateWorker` from `workerSettingsApi` and expose:

```ts
setWorkerEnabled: (workerName: string, enabled: boolean) => Promise<void>;
togglingWorkerName: string | null;
```

Implementation contract:

- Get access token.
- Set `togglingWorkerName` before the API call.
- Call `updateWorker(token, workerName, { enabled })`.
- Call `refreshStatus()` after the API succeeds.
- Clear `togglingWorkerName` in `finally`.
- Surface failures through `error`.

Run: `pnpm --filter web test -- useCodeTasks`

Expected: PASS after adding tests that `setWorkerEnabled('mac-dev', false)` PATCHes `{ enabled: false }` and refreshes status.

- [ ] **Step 3: Update header dropdown rendering**

In `apps/web/src/components/Header.tsx`:

- Extend `getStatusDisplay()` with disabled:

```ts
if (worker.status === 'disabled' || worker.enabled === false) {
  return { text: 'Disabled', color: 'bg-yellow-500' };
}
```

- Render `display.color` as a CSS status dot instead of adding another literal status glyph:

```tsx
<span
  aria-label={display.text}
  className={`h-2.5 w-2.5 rounded-full ${display.color}`}
/>
```

- Replace `getWorkersDotColor()` with aggregate precedence:

```ts
const getWorkersDotColor = (workers: WorkerStatus[]): string => {
  if (workers.length === 0) return 'bg-gray-400';
  const enabledWorkers = workers.filter((w) => w.enabled);
  const hasDisabled = workers.some((w) => !w.enabled || w.status === 'disabled');
  const hasHealthyEnabled = enabledWorkers.some((w) => w.healthy);
  const hasRedEnabled = enabledWorkers.some((w) => !w.healthy && w.status !== 'disabled');
  if (hasRedEnabled && !hasHealthyEnabled) return 'bg-red-500';
  if (hasDisabled) return 'bg-yellow-500';
  if (hasHealthyEnabled) return 'bg-green-500';
  return 'bg-red-500';
};
```

- Add a compact switch beside each worker in both the desktop dropdown and mobile/PWA menu worker list.
- The switch calls `setWorkerEnabled(worker.name, !worker.enabled)`.
- Disable only the switch for `togglingWorkerName === worker.name`.
- Use `role="switch"` and `aria-checked={worker.enabled}`.

Run: `pnpm --filter web test -- Header`

Expected: PASS after tests assert yellow disabled workers, aggregate yellow, and toggle callback behavior.

- [ ] **Step 4: Update Code Settings worker rows**

In `apps/web/src/components/workers/WorkerRow.tsx`:

- Add a switch visible in the row header.
- Call `onUpdate({ enabled: !worker.enabled })`.
- Track per-row saving state for the enable switch separately from credential edit saving.
- Remove or keep the current `Enabled: Yes/No` text only if it does not duplicate the switch in a cramped way; the switch label should remain accessible through `aria-label`.
- Keep the existing credential update form unchanged; it must not require credential fields when only toggling enabled.

Run: `pnpm --filter web test -- WorkerSettingsPage`

Expected: PASS after tests assert the switch is rendered and `updateWorker(worker.name, { enabled: false })` is called.

- [ ] **Step 5: Verify web boundary**

Run:

```bash
pnpm --filter web test -- Header WorkerSettingsPage useCodeTasks workerSettingsApi
pnpm --filter web build
```

Expected: all selected tests and build pass.

## Task 3: Integration Verification

**Files:**

- No new implementation files beyond Tasks 1 and 2.

- [ ] **Step 1: Run focused cross-boundary checks**

Run:

```bash
pnpm --filter code-agent test -- src/__tests__/routes/codeRoutes.test.ts
pnpm --filter web test -- Header WorkerSettingsPage useCodeTasks
pnpm --filter migrations test -- 101-backfill-code-worker-settings-enabled
```

Expected: all focused tests pass.

- [ ] **Step 2: Run tracked CI**

Run:

```bash
pnpm run ci:tracked
```

Expected: CI passes completely before any implementation PR is opened.

- [ ] **Step 3: Manual browser smoke test**

Use the web app against the dev environment after deployment:

- Open the worker status dropdown.
- Disable `mac-dev`.
- Confirm `mac-dev` turns yellow and status text says `Disabled`.
- Confirm the aggregate worker icon is yellow when disabled state is present without red failures.
- Open Code Settings and confirm the same switch state is shown.
- Re-enable `mac-dev`.
- Submit or queue a task and confirm dispatch does not call disabled workers during the disabled interval.

## Self-Review

- Spec coverage: enable/disable toggles are planned for the worker status dropdown and Code Settings; default enabled behavior is covered for new and historical records; dispatch skips disabled workers; disabled UI color and aggregate color are specified.
- Placeholder scan completed: tasks use concrete file paths, commands, and expected outcomes.
- Type consistency: backend and frontend both use `enabled: boolean` and `status: 'disabled'`; toggle writes use the already-existing `WorkerConfigUpdateInput.enabled`.
