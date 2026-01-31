# INT-156 Legacy Worker Discovery Cleanup Plan

## Overview

Remove legacy `INTEXURAOS_CODE_WORKERS` env var-based worker discovery and replace with per-user Firestore-based worker settings.

## Pre-Conditions

- [ ] `pnpm run ci:tracked` passes before starting
- [ ] On `development` branch with clean working directory

---

## Phase 1: Remove Legacy WorkerDiscovery Service

### Task 1.1: Remove workerDiscovery from ServiceContainer

**File:** `apps/code-agent/src/services.ts`

**Actions:**

1. Remove import: `import type { WorkerDiscoveryService } from './domain/services/workerDiscovery.js';`
2. Remove import: `import { createWorkerDiscoveryService } from './infra/services/workerDiscoveryImpl.js';`
3. Remove from `ServiceContainer` interface: `workerDiscovery: WorkerDiscoveryService;`
4. Remove from `initializeServices()`: `workerDiscovery: createWorkerDiscoveryService({ logger }),`

**Verification:**

```bash
grep -c "workerDiscovery" apps/code-agent/src/services.ts
# Expected: 0
```

### Task 1.2: Delete legacy service files

**Actions:**

1. Delete file: `apps/code-agent/src/infra/services/workerDiscoveryImpl.ts`
2. Delete file: `apps/code-agent/src/domain/services/workerDiscovery.ts`

**Verification:**

```bash
ls apps/code-agent/src/infra/services/workerDiscoveryImpl.ts 2>&1 | grep -c "No such file"
# Expected: 1
ls apps/code-agent/src/domain/services/workerDiscovery.ts 2>&1 | grep -c "No such file"
# Expected: 1
```

### Task 1.3: Remove INTEXURAOS_CODE_WORKERS from env vars list

**File:** `scripts/verify-env-vars.mjs`

**Action:** Remove `'INTEXURAOS_CODE_WORKERS',` from the `KNOWN_ENV_VARS` array (around line 48)

**Verification:**

```bash
grep -c "INTEXURAOS_CODE_WORKERS" scripts/verify-env-vars.mjs
# Expected: 0
```

### Task 1.4: Update index.ts comment

**File:** `apps/code-agent/src/index.ts`

**Action:** Remove `INTEXURAOS_CODE_WORKERS` from the comment on line 23. Change:

```typescript
 * - INTEXURAOS_CODE_WORKERS, INTEXURAOS_SERVICE_URL: Worker configuration
```

To:

```typescript
 * - INTEXURAOS_SERVICE_URL: Service URL configuration
```

**Verification:**

```bash
grep -c "INTEXURAOS_CODE_WORKERS" apps/code-agent/src/index.ts
# Expected: 0
```

---

## Phase 2: Update /code/workers/status Endpoint

### Task 2.1: Replace legacy endpoint with user-based worker status

**File:** `apps/code-agent/src/routes/codeRoutes.ts`

**Location:** Find `GET /code/workers/status` endpoint (around line 1800-1900)

**Current implementation (REMOVE):**

```typescript
const { workerDiscovery } = getServices();
const [macResult, vmResult] = await Promise.all([
  workerDiscovery.checkHealth('mac'),
  workerDiscovery.checkHealth('vm'),
]);
// ... returns { mac: macStatus, vm: vmStatus }
```

**New implementation (REPLACE WITH):**

```typescript
const { workerSettingsRepository } = getServices();
const userId = request.user?.sub;

if (!userId) {
  return reply.fail(401, 'UNAUTHORIZED', 'Authentication required');
}

const settingsResult = await workerSettingsRepository.getByUserId(userId);

if (!settingsResult.ok) {
  return reply.ok({ workers: [] });
}

const workers = settingsResult.value.workers.map((w) => ({
  name: w.name,
  url: w.url,
  priority: w.priority,
  healthy: true, // Status unknown without actual health check
  checkedAt: new Date().toISOString(),
}));

return reply.ok({ workers });
```

**Also update the OpenAPI schema** in the same endpoint definition:

- Change response schema from `{ mac: {...}, vm: {...} }` to `{ workers: [...] }`
- Update `required` array from `['mac', 'vm']` to `['workers']`

**Verification:**

```bash
grep -c "workerDiscovery" apps/code-agent/src/routes/codeRoutes.ts
# Expected: 0
grep -c "checkHealth.*mac" apps/code-agent/src/routes/codeRoutes.ts
# Expected: 0
```

---

## Phase 3: Update Type Definitions

### Task 3.1: Update web app WorkerLocation type

**File:** `apps/web/src/types/index.ts`

**Action:** Change line 1031 from:

```typescript
export type CodeTaskWorkerLocation = 'mac' | 'vm';
```

To:

```typescript
export type CodeTaskWorkerLocation = string;
```

**Verification:**

```bash
grep "CodeTaskWorkerLocation" apps/web/src/types/index.ts | grep -c "'mac' | 'vm'"
# Expected: 0
```

### Task 3.2: Update E2E client type

**File:** `e2e/helpers/client.ts`

**Action:** Change line 74 from:

```typescript
workerLocation: 'mac' | 'vm';
```

To:

```typescript
workerLocation: string;
```

**Verification:**

```bash
grep "workerLocation" e2e/helpers/client.ts | grep -c "'mac' | 'vm'"
# Expected: 0
```

---

## Phase 4: Update Test Files

### Task 4.1: Remove INTEXURAOS_CODE_WORKERS from test setup

**Files to update:** (remove `process.env['INTEXURAOS_CODE_WORKERS'] = ...` lines)

- `apps/code-agent/src/__tests__/routes/codeCancel.test.ts` (line 66)
- `apps/code-agent/src/__tests__/routes/codeProcess.test.ts` (line 65)
- `apps/code-agent/src/__tests__/routes/codeTasks.test.ts` (line 64)
- `apps/code-agent/src/__tests__/routes/codeSubmit.test.ts` (line 65)
- `apps/code-agent/src/__tests__/routes/codeRoutes.test.ts` (line 72)
- `apps/code-agent/src/__tests__/routes/webhooks.test.ts` (lines 74, 1252, 1565, 1984)
- `apps/code-agent/src/__tests__/openapi-contract.test.ts` (line 52)

**Verification:**

```bash
grep -r "INTEXURAOS_CODE_WORKERS" apps/code-agent/src/__tests__/ | wc -l
# Expected: 0
```

### Task 4.2: Remove workerDiscovery from test ServiceContainer setups

**Files to update:** Remove `workerDiscovery` from `setServices()` calls and imports

- `apps/code-agent/src/__tests__/routes/codeCancel.test.ts`
- `apps/code-agent/src/__tests__/routes/codeProcess.test.ts`
- `apps/code-agent/src/__tests__/routes/codeTasks.test.ts`
- `apps/code-agent/src/__tests__/routes/codeSubmit.test.ts`
- `apps/code-agent/src/__tests__/routes/codeRoutes.test.ts`
- `apps/code-agent/src/__tests__/routes/webhooks.test.ts`
- `apps/code-agent/src/__tests__/routes/workerSettingsRoutes.test.ts`
- `apps/code-agent/src/__tests__/openapi-contract.test.ts`
- `apps/code-agent/src/__tests__/helpers/mockServices.ts`

**Actions per file:**

1. Remove import of `createWorkerDiscoveryService`
2. Remove import of `WorkerDiscoveryService` type
3. Remove `workerDiscovery` variable creation
4. Remove `workerDiscovery` from `setServices()` call
5. Remove `workerDiscovery` from `ServiceContainer` type assertion

**Verification:**

```bash
grep -r "workerDiscovery" apps/code-agent/src/__tests__/ | wc -l
# Expected: 0
grep -r "WorkerDiscoveryService" apps/code-agent/src/__tests__/ | wc -l
# Expected: 0
grep -r "createWorkerDiscoveryService" apps/code-agent/src/__tests__/ | wc -l
# Expected: 0
```

### Task 4.3: Update E2E tests for new /code/workers/status response

**File:** `e2e/tests/code-tasks.spec.ts`

**Action:** Update tests that check for `mac`/`vm` properties (lines 46-47, 313-317) to check for `workers` array instead.

Change from:

```typescript
expect(response.data.data).toHaveProperty('mac');
expect(response.data.data).toHaveProperty('vm');
```

To:

```typescript
expect(response.data.data).toHaveProperty('workers');
expect(Array.isArray(response.data.data.workers)).toBe(true);
```

**Verification:**

```bash
grep -c "toHaveProperty('mac')" e2e/tests/code-tasks.spec.ts
# Expected: 0
grep -c "toHaveProperty('vm')" e2e/tests/code-tasks.spec.ts
# Expected: 0
```

---

## Phase 5: Update Orchestrator (Optional - May Require Separate Ticket)

### Task 5.1: Assess orchestrator impact

**Files affected:**

- `workers/orchestrator/src/services/task-dispatcher.ts:96` - hardcodes `machine: 'mac'`
- `workers/orchestrator/src/services/tmux-manager.ts:31,168` - `machine: 'mac' | 'vm'`

**Note:** This may require a separate ticket as orchestrator changes may have broader implications. For now, document that these are legacy but functional.

---

## Final Verification

After all phases complete:

```bash
# 1. No references to legacy env var
grep -r "INTEXURAOS_CODE_WORKERS" apps/ scripts/ --include="*.ts" --include="*.mjs" | wc -l
# Expected: 0

# 2. No references to workerDiscovery service
grep -r "workerDiscovery" apps/code-agent/src/ --include="*.ts" | wc -l
# Expected: 0

# 3. No hardcoded mac/vm in worker status endpoint
grep -A5 "workers/status" apps/code-agent/src/routes/codeRoutes.ts | grep -c "'mac'\|'vm'"
# Expected: 0

# 4. Legacy files deleted
ls apps/code-agent/src/infra/services/workerDiscoveryImpl.ts 2>&1 | grep -c "No such file"
# Expected: 1
ls apps/code-agent/src/domain/services/workerDiscovery.ts 2>&1 | grep -c "No such file"
# Expected: 1

# 5. CI passes
pnpm run ci:tracked
# Expected: ✅ CI passed

# 6. Typecheck passes
pnpm run typecheck
# Expected: No errors
```

---

## Commit Strategy

1. **Commit 1:** Phase 1 - Remove WorkerDiscovery service
2. **Commit 2:** Phase 2 - Update endpoint
3. **Commit 3:** Phase 3 - Update types
4. **Commit 4:** Phase 4 - Update tests
5. **Final:** Squash or keep separate based on preference

Each commit should pass `pnpm run ci:tracked` before proceeding.

---

## Rollback Plan

If issues arise:

1. `git revert` the commits
2. Re-add `INTEXURAOS_CODE_WORKERS` to terraform if it was removed
3. The env var is currently optional (returns empty worker list), so partial rollback is safe
