# Split code-agent Route Files Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split `codeRoutes.ts` (3,775 lines) into ~14 domain-focused route files, extract shared utilities, and remove blanket ESLint disables.

**Architecture:** Hexagonal architecture with route files organized by domain concern. Internal routes in `routes/internal/`, public routes in `routes/code/`. Shared types/utilities in `routes/shared.ts`. Each route file follows `FastifyPluginCallback` pattern with `logIncomingRequest()` at entry.

**Tech Stack:** Fastify, TypeScript, ESM imports (.js extensions), Vitest for testing.

**Linear Issue:** [INT-613](https://linear.app/pbuchman/issue/INT-613)

---

## Parallel Execution Strategy

This plan supports **3 parallel workstreams** after Phase 1 completes:

```
Phase 1 (Sequential - Foundation)
└── Task 1: Extract shared.ts

Phase 2 (Parallel - 3 Independent Streams)
├── Stream A: Internal Routes (7 files)
├── Stream B: Public Routes (5 files)
└── Stream C: Test Restructuring

Phase 3 (Sequential - Integration)
├── Wire up index.ts
├── Delete codeRoutes.ts monolith
├── Remove ESLint disables from webhookRoutes.ts
└── Update technical-debt.md
```

---

## Current State Analysis

**Routes in codeRoutes.ts (20 routes):**

| Route                                                   | Line   | Target File                   |
| ------------------------------------------------------- | ------ | ----------------------------- |
| `POST /internal/code/process`                           | 314    | `internal/process.ts`         |
| `PATCH /internal/code-tasks/:taskId`                    | 603    | `internal/taskUpdate.ts`      |
| `GET /internal/code-tasks/linear/:linearIssueId/active` | 820    | `internal/linearActive.ts`    |
| `GET /internal/code-tasks/zombies`                      | 905    | `internal/zombies.ts`         |
| `POST /internal/code/heartbeat`                         | 2460   | `internal/maintenance.ts`     |
| `POST /internal/code/detect-zombies`                    | 2535   | `internal/maintenance.ts`     |
| `POST /internal/code/cancel-with-nonce`                 | 2612   | `internal/cancelWithNonce.ts` |
| `POST /internal/code/submit-phase2`                     | 2786   | `internal/submitPhase2.ts`    |
| `POST /internal/tasks/cleanup-logs`                     | 2912   | `internal/maintenance.ts`     |
| `POST /code/submit`                                     | 1013   | `code/submit.ts`              |
| `GET /code/tasks`                                       | 1436   | `code/tasks.ts`               |
| `GET /code/tasks/:taskId`                               | 1582   | `code/tasks.ts`               |
| `DELETE /code/tasks/:taskId`                            | 1843   | `code/tasks.ts`               |
| `POST /code/cancel`                                     | 1911   | `code/cancel.ts`              |
| `GET /code/workers/status`                              | 2096   | `code/workers.ts`             |
| `POST /code/workers/refresh-status`                     | 2299   | `code/workers.ts`             |
| `POST /code/retry`                                      | 3056   | `code/lifecycle.ts`           |
| `POST /code/tasks/:taskId/feedback`                     | 3265   | `code/lifecycle.ts`           |
| `POST /code/tasks/:taskId/implement`                    | 3462   | `code/lifecycle.ts`           |
| `POST /code/tasks/:taskId/messages`                     | 3683   | `code/lifecycle.ts`           |

**Existing dedicated test files (DO NOT MODIFY):**
- `codeSubmit.test.ts` (935 lines)
- `codeCancel.test.ts` (764 lines)
- `codeTasks.test.ts` (739 lines)
- `codeProcess.test.ts` (633 lines)

**Tests in `codeRoutes.test.ts` to migrate (2,920 lines):**
- Workers routes tests → `code/workers.test.ts`
- Lifecycle routes tests → `code/lifecycle.test.ts`
- Internal maintenance tests → `internal/maintenance.test.ts`
- Internal taskUpdate tests → `internal/taskUpdate.test.ts`
- Internal linearActive tests → `internal/linearActive.test.ts`
- Internal zombies tests → `internal/zombies.test.ts`
- Internal cancelWithNonce tests → `internal/cancelWithNonce.test.ts`
- Internal submitPhase2 tests → `internal/submitPhase2.test.ts`

---

## Phase 1: Extract Shared Module (Sequential - Foundation)

### Task 1.1: Create routes/shared.ts

**Files:**
- Create: `apps/code-agent/src/routes/shared.ts`
- Modify: `apps/code-agent/src/routes/codeRoutes.ts` (update exports)

**Step 1: Create shared.ts with types and utilities**

Extract from `codeRoutes.ts` lines 32-290:
- `JwtValidator` type (line 32)
- `CodeRoutesOptions` interface (line 34-36)
- `codeTaskSchema` constant (lines 37-116)
- `timestampToIso()` function (lines 122-135)
- `taskToApiResponse()` function (lines 140-290)

```typescript
// apps/code-agent/src/routes/shared.ts
import type { FastifyRequest, FastifyReply } from 'fastify';

export type JwtValidator = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export interface CodeRoutesOptions {
  jwtValidator: JwtValidator;
}

// Response schema for created task
export const codeTaskSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    // ... copy full schema from codeRoutes.ts lines 40-116
  },
  required: [
    'id', 'userId', 'prompt', /* ... rest of required fields */
  ],
} as const;

/**
 * Convert Firestore Timestamp to ISO string for JSON serialization
 * Exported for testing
 */
export function timestampToIso(
  timestamp: { toDate: () => Date } | string | undefined
): string | undefined {
  if (timestamp === undefined) {
    return undefined;
  }
  if (typeof timestamp === 'string') {
    return timestamp;
  }
  if (typeof timestamp.toDate === 'function') {
    return timestamp.toDate().toISOString();
  }
  return undefined;
}

/**
 * Convert CodeTask domain model to API response format
 */
export function taskToApiResponse(task: { /* ... full type from codeRoutes.ts */ }) {
  // ... copy full implementation from codeRoutes.ts lines 140-290
}
```

**Step 2: Run typecheck to verify extraction**

Run: `pnpm --filter code-agent run typecheck`
Expected: Passes (shared.ts compiles)

**Step 3: Update imports in dependent files**

Update these files to import from `shared.ts` instead of `codeRoutes.ts`:
- `routes/code/github-pre-events.ts` line 12-18
- `routes/workerSettingsRoutes.ts` (search for JwtValidator import)
- `routes/index.ts` line 2

**Step 4: Verify all imports work**

Run: `pnpm --filter code-agent run typecheck`
Expected: Passes

**Step 5: Commit**

```bash
git add apps/code-agent/src/routes/shared.ts apps/code-agent/src/routes/code/github-pre-events.ts apps/code-agent/src/routes/index.ts apps/code-agent/src/routes/workerSettingsRoutes.ts
git commit -m "refactor(code-agent): extract shared types and utilities to routes/shared.ts

Molded with love by 🤖 <a href=\"mailto:intex@intexuraos.cloud\">Intex</a>"
```

---

## Phase 2, Stream A: Internal Routes (7 files)

Can run in parallel with Stream B and Stream C after Phase 1 completes.

### Task 2A.1: Create routes/internal/process.ts

**Files:**
- Create: `apps/code-agent/src/routes/internal/process.ts`
- Reference: `codeRoutes.ts` lines 292-568

**Step 1: Write failing test**

Create minimal test that imports the route plugin:

```typescript
// apps/code-agent/src/__tests__/routes/internal/process.test.ts
import { describe, it, expect } from 'vitest';
import process from '../../../routes/internal/process.js';

describe('POST /internal/code/process', () => {
  it('exports a FastifyPluginCallback', () => {
    expect(typeof process).toBe('function');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter code-agent run test -- src/__tests__/routes/internal/process.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Create the route file**

```typescript
// apps/code-agent/src/routes/internal/process.ts
import type { FastifyPluginCallback } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { getServices } from '../../services.js';
import { processCodeAction } from '../../domain/usecases/processCodeAction.js';
// ... copy implementation from codeRoutes.ts lines 292-568

const processRoute: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post<{ /* ... */ }>(
    '/internal/code/process',
    {
      // ... schema and handler from codeRoutes.ts
    }
  );
  done();
};

export default processRoute;
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter code-agent run test -- src/__tests__/routes/internal/process.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/code-agent/src/routes/internal/process.ts apps/code-agent/src/__tests__/routes/internal/process.test.ts
git commit -m "refactor(code-agent): extract /internal/code/process route

Molded with love by 🤖 <a href=\"mailto:intex@intexuraos.cloud\">Intex</a>"
```

### Task 2A.2: Create routes/internal/taskUpdate.ts

**Files:**
- Create: `apps/code-agent/src/routes/internal/taskUpdate.ts`
- Reference: `codeRoutes.ts` lines 570-814

Follow same pattern as Task 2A.1:
1. Write failing test
2. Run test to verify failure
3. Create route file (copy from lines 570-814)
4. Run test to verify pass
5. Commit

### Task 2A.3: Create routes/internal/linearActive.ts

**Files:**
- Create: `apps/code-agent/src/routes/internal/linearActive.ts`
- Reference: `codeRoutes.ts` lines 816-897

Follow same pattern as Task 2A.1.

### Task 2A.4: Create routes/internal/zombies.ts

**Files:**
- Create: `apps/code-agent/src/routes/internal/zombies.ts`
- Reference: `codeRoutes.ts` lines 899-1006

Follow same pattern as Task 2A.1.

### Task 2A.5: Create routes/internal/maintenance.ts

**Files:**
- Create: `apps/code-agent/src/routes/internal/maintenance.ts`
- Reference: `codeRoutes.ts` lines 2449-2594 (heartbeat, detect-zombies) + lines 2905-3048 (cleanup-logs)

This file contains 3 routes:
- `POST /internal/code/heartbeat`
- `POST /internal/code/detect-zombies`
- `POST /internal/tasks/cleanup-logs`

Follow same pattern as Task 2A.1.

### Task 2A.6: Create routes/internal/cancelWithNonce.ts

**Files:**
- Create: `apps/code-agent/src/routes/internal/cancelWithNonce.ts`
- Reference: `codeRoutes.ts` lines 2595-2778

Follow same pattern as Task 2A.1.

### Task 2A.7: Create routes/internal/submitPhase2.ts

**Files:**
- Create: `apps/code-agent/src/routes/internal/submitPhase2.ts`
- Reference: `codeRoutes.ts` lines 2779-2903

Follow same pattern as Task 2A.1.

### Task 2A.8: Create routes/internal/index.ts

**Files:**
- Create: `apps/code-agent/src/routes/internal/index.ts`

```typescript
// apps/code-agent/src/routes/internal/index.ts
import type { FastifyPluginCallback } from 'fastify';
import processRoute from './process.js';
import taskUpdateRoute from './taskUpdate.js';
import linearActiveRoute from './linearActive.js';
import zombiesRoute from './zombies.js';
import maintenanceRoute from './maintenance.js';
import cancelWithNonceRoute from './cancelWithNonce.js';
import submitPhase2Route from './submitPhase2.js';

const internalRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.register(processRoute);
  fastify.register(taskUpdateRoute);
  fastify.register(linearActiveRoute);
  fastify.register(zombiesRoute);
  fastify.register(maintenanceRoute);
  fastify.register(cancelWithNonceRoute);
  fastify.register(submitPhase2Route);
  done();
};

export default internalRoutes;
```

**Step 1: Verify typecheck passes**

Run: `pnpm --filter code-agent run typecheck`
Expected: Passes

**Step 2: Commit**

```bash
git add apps/code-agent/src/routes/internal/index.ts
git commit -m "refactor(code-agent): add internal routes index

Molded with love by 🤖 <a href=\"mailto:intex@intexuraos.cloud\">Intex</a>"
```

---

## Phase 2, Stream B: Public Routes (5 files)

Can run in parallel with Stream A and Stream C after Phase 1 completes.

### Task 2B.1: Create routes/code/submit.ts

**Files:**
- Create: `apps/code-agent/src/routes/code/submit.ts`
- Reference: `codeRoutes.ts` lines 1007-1430

**Note:** Tests already exist in `codeSubmit.test.ts`. After extraction, verify existing tests still pass.

**Step 1: Create the route file**

Copy implementation from codeRoutes.ts lines 1007-1430, updating imports to use shared.ts.

**Step 2: Verify existing tests pass**

Run: `pnpm --filter code-agent run test -- src/__tests__/routes/codeSubmit.test.ts`
Expected: Tests may fail until integration (Phase 3)

**Step 3: Commit**

```bash
git add apps/code-agent/src/routes/code/submit.ts
git commit -m "refactor(code-agent): extract /code/submit route

Molded with love by 🤖 <a href=\"mailto:intex@intexuraos.cloud\">Intex</a>"
```

### Task 2B.2: Create routes/code/tasks.ts

**Files:**
- Create: `apps/code-agent/src/routes/code/tasks.ts`
- Reference: `codeRoutes.ts` lines 1432-1903 (GET /code/tasks, GET /code/tasks/:taskId, DELETE /code/tasks/:taskId)

Follow same pattern. Existing tests in `codeTasks.test.ts`.

### Task 2B.3: Create routes/code/cancel.ts

**Files:**
- Create: `apps/code-agent/src/routes/code/cancel.ts`
- Reference: `codeRoutes.ts` lines 1905-2088

Follow same pattern. Existing tests in `codeCancel.test.ts`.

### Task 2B.4: Create routes/code/workers.ts

**Files:**
- Create: `apps/code-agent/src/routes/code/workers.ts`
- Create: `apps/code-agent/src/__tests__/routes/code/workers.test.ts`
- Reference: `codeRoutes.ts` lines 2090-2447 + module-level `inFlightRequests` Map and `logger`

**Important:** This file includes module-level state (`inFlightRequests` Map). Keep it encapsulated in this file.

**Step 1: Write failing test**

```typescript
// apps/code-agent/src/__tests__/routes/code/workers.test.ts
import { describe, it, expect } from 'vitest';
import workersRoute from '../../../routes/code/workers.js';

describe('workers routes', () => {
  it('exports a FastifyPluginCallback', () => {
    expect(typeof workersRoute).toBe('function');
  });
});
```

**Step 2: Run test to verify failure**

Run: `pnpm --filter code-agent run test -- src/__tests__/routes/code/workers.test.ts`
Expected: FAIL

**Step 3: Create route file and run tests**

**Step 4: Migrate worker tests from codeRoutes.test.ts**

Search `codeRoutes.test.ts` for `workers/status` and `workers/refresh-status` describe blocks. Copy to `workers.test.ts`.

**Step 5: Commit**

### Task 2B.5: Create routes/code/lifecycle.ts

**Files:**
- Create: `apps/code-agent/src/routes/code/lifecycle.ts`
- Create: `apps/code-agent/src/__tests__/routes/code/lifecycle.test.ts`
- Reference: `codeRoutes.ts` lines 3050-3775 (retry, feedback, implement, messages)

Follow same pattern as Task 2B.4. This file contains 4 routes:
- `POST /code/retry`
- `POST /code/tasks/:taskId/feedback`
- `POST /code/tasks/:taskId/implement`
- `POST /code/tasks/:taskId/messages`

### Task 2B.6: Update routes/code/index.ts

**Files:**
- Modify: `apps/code-agent/src/routes/code/index.ts`

```typescript
// apps/code-agent/src/routes/code/index.ts
import githubPREventsRoute from './github-pre-events.js';
import githubPRSummariesRoute from './github-pr-summaries.js';
import submitRoute from './submit.js';
import tasksRoute from './tasks.js';
import cancelRoute from './cancel.js';
import workersRoute from './workers.js';
import lifecycleRoute from './lifecycle.js';

export {
  githubPREventsRoute,
  githubPRSummariesRoute,
  submitRoute,
  tasksRoute,
  cancelRoute,
  workersRoute,
  lifecycleRoute,
};
```

**Step 1: Verify typecheck passes**

Run: `pnpm --filter code-agent run typecheck`

**Step 2: Commit**

---

## Phase 2, Stream C: Test Restructuring

Can run in parallel with Stream A and Stream B after Phase 1 completes.

### Task 2C.1: Identify duplicate test blocks in codeRoutes.test.ts

**Files:**
- Analyze: `apps/code-agent/src/__tests__/routes/codeRoutes.test.ts`

**Step 1: Search for describe blocks that duplicate existing tests**

Look for these patterns that are already covered by dedicated test files:
- `/code/submit` → covered by `codeSubmit.test.ts`
- `/code/tasks` → covered by `codeTasks.test.ts`
- `/code/cancel` → covered by `codeCancel.test.ts`
- `/internal/code/process` → covered by `codeProcess.test.ts`

**Step 2: Create a list of describe blocks to REMOVE**

**Step 3: Create a list of describe blocks to MIGRATE**

Blocks to migrate to new test files:
- Workers tests → `code/workers.test.ts`
- Lifecycle tests → `code/lifecycle.test.ts`
- Internal maintenance → `internal/maintenance.test.ts`
- etc.

### Task 2C.2-2C.8: Create new test files

For each domain not yet covered, create a test file by migrating tests from `codeRoutes.test.ts`:

| New Test File                             | Source describe blocks                     |
| ----------------------------------------- | ------------------------------------------ |
| `routes/internal/taskUpdate.test.ts`      | PATCH /internal/code-tasks/:taskId         |
| `routes/internal/linearActive.test.ts`    | GET /internal/code-tasks/linear/:id/active |
| `routes/internal/zombies.test.ts`         | GET /internal/code-tasks/zombies           |
| `routes/internal/maintenance.test.ts`     | heartbeat, detect-zombies, cleanup-logs    |
| `routes/internal/cancelWithNonce.test.ts` | POST /internal/code/cancel-with-nonce      |
| `routes/internal/submitPhase2.test.ts`    | POST /internal/code/submit-phase2          |
| `routes/code/workers.test.ts`             | workers/status, workers/refresh-status     |
| `routes/code/lifecycle.test.ts`           | retry, feedback, implement, messages       |

---

## Phase 3: Integration (Sequential)

### Task 3.1: Update routes/index.ts

**Files:**
- Modify: `apps/code-agent/src/routes/index.ts`

```typescript
import type { FastifyInstance } from 'fastify';
import type { JwtValidator, CodeRoutesOptions } from './shared.js';
import { webhookRoutes } from './webhookRoutes.js';
import { workerSettingsRoutes } from './workerSettingsRoutes.js';
import { webhooksRoutes } from './webhooks/index.js';
import internalRoutes from './internal/index.js';
import {
  githubPREventsRoute,
  githubPRSummariesRoute,
  submitRoute,
  tasksRoute,
  cancelRoute,
  workersRoute,
  lifecycleRoute,
} from './code/index.js';

export interface RoutesDeps {
  jwtValidator: JwtValidator;
}

export async function registerRoutes(app: FastifyInstance, deps: RoutesDeps): Promise<void> {
  // Internal routes (no JWT)
  await app.register(internalRoutes);

  // Public code routes (JWT required)
  await app.register(submitRoute, deps);
  await app.register(tasksRoute, deps);
  await app.register(cancelRoute, deps);
  await app.register(workersRoute, deps);
  await app.register(lifecycleRoute, deps);

  // GitHub routes
  await app.register(githubPREventsRoute, deps);
  await app.register(githubPRSummariesRoute, deps);

  // Other routes
  await app.register(webhookRoutes);
  await app.register(workerSettingsRoutes, deps);
  await app.register(webhooksRoutes);
}
```

**Step 1: Verify all routes work**

Run: `pnpm --filter code-agent run test`
Expected: All tests pass

**Step 2: Commit**

### Task 3.2: Delete codeRoutes.ts

**Files:**
- Delete: `apps/code-agent/src/routes/codeRoutes.ts`

**Step 1: Remove the file**

```bash
rm apps/code-agent/src/routes/codeRoutes.ts
```

**Step 2: Verify typecheck and tests pass**

Run: `pnpm --filter code-agent run typecheck && pnpm --filter code-agent run test`
Expected: All pass

**Step 3: Commit**

```bash
git add -A
git commit -m "refactor(code-agent): delete codeRoutes.ts monolith

3,775 lines split into 14 domain-focused route files.

Molded with love by 🤖 <a href=\"mailto:intex@intexuraos.cloud\">Intex</a>"
```

### Task 3.3: Clean up codeRoutes.test.ts

**Files:**
- Modify: `apps/code-agent/src/__tests__/routes/codeRoutes.test.ts`

**Step 1: Remove duplicate describe blocks**

Remove all describe blocks that are now covered by dedicated test files.

**Step 2: Delete the file if empty**

If all tests have been migrated, delete the file entirely.

**Step 3: Verify all tests pass**

Run: `pnpm --filter code-agent run test`
Expected: All pass

**Step 4: Commit**

### Task 3.4: Remove ESLint disable from webhookRoutes.ts

**Files:**
- Modify: `apps/code-agent/src/routes/webhookRoutes.ts`

**Step 1: Remove `/* eslint-disable */` from line 1**

**Step 2: Run lint**

Run: `pnpm --filter code-agent run lint`
Expected: Lint errors appear

**Step 3: Fix lint errors**

Use targeted `eslint-disable-next-line` comments for genuinely necessary exceptions.

**Step 4: Verify lint passes**

Run: `pnpm --filter code-agent run lint`
Expected: Passes

**Step 5: Commit**

```bash
git add apps/code-agent/src/routes/webhookRoutes.ts
git commit -m "refactor(code-agent): remove blanket ESLint disable from webhookRoutes.ts

Molded with love by 🤖 <a href=\"mailto:intex@intexuraos.cloud\">Intex</a>"
```

### Task 3.5: Update technical-debt.md

**Files:**
- Modify: `docs/services/code-agent/technical-debt.md`

**Step 1: Move resolved items**

Move these items from active debt to Resolved Issues:
- "codeRoutes.ts is ~3600 lines (SRP violation)" → Resolved
- "ESLint disabled for entire route files" → Resolved

**Step 2: Update summary counts**

**Step 3: Commit**

### Task 3.6: Run full CI

**Step 1: Run ci:tracked**

Run: `pnpm run ci:tracked`
Expected: All phases pass

**Step 2: If failures, fix them**

**Step 3: Final commit if needed**

---

## Acceptance Criteria Checklist

- [ ] `codeRoutes.ts` deleted — replaced by ~14 domain-focused route files
- [ ] No file exceeds ~500 lines (excluding schemas)
- [ ] No file-level `/* eslint-disable */` remains in any route file
- [ ] All existing routes continue to work (same paths, same behavior)
- [ ] `JwtValidator` and `CodeRoutesOptions` exported from `routes/shared.ts`
- [ ] `timestampToIso` and `taskToApiResponse` exported from `routes/shared.ts`
- [ ] All test files pass — no test regressions
- [ ] `pnpm run ci:tracked` passes
- [ ] `technical-debt.md` updated — SRP violation and ESLint items moved to Resolved

---

## File Summary

### New Files (14)

| Path                                 | Lines (approx)   |
| ------------------------------------ | ---------------- |
| `routes/shared.ts`                   | ~290             |
| `routes/internal/index.ts`           | ~30              |
| `routes/internal/process.ts`         | ~280             |
| `routes/internal/taskUpdate.ts`      | ~250             |
| `routes/internal/linearActive.ts`    | ~85              |
| `routes/internal/zombies.ts`         | ~100             |
| `routes/internal/maintenance.ts`     | ~350             |
| `routes/internal/cancelWithNonce.ts` | ~180             |
| `routes/internal/submitPhase2.ts`    | ~130             |
| `routes/code/submit.ts`              | ~420             |
| `routes/code/tasks.ts`               | ~480             |
| `routes/code/cancel.ts`              | ~190             |
| `routes/code/workers.ts`             | ~370             |
| `routes/code/lifecycle.ts`           | ~730             |

### Files to Delete (1)

| Path                   |
| ---------------------- |
| `routes/codeRoutes.ts` |

### Files to Modify (5)

| Path                                         | Change                              |
| -------------------------------------------- | ----------------------------------- |
| `routes/index.ts`                            | Replace codeRoutes with new plugins |
| `routes/code/index.ts`                       | Add new route exports               |
| `routes/code/github-pre-events.ts`           | Update import from shared.ts        |
| `routes/webhookRoutes.ts`                    | Remove `/* eslint-disable */`       |
| `docs/services/code-agent/technical-debt.md` | Move items to Resolved              |
