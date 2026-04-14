# Execution Memory: Use User Default Model Instead of Hard-Coded Gemini 2.5 Flash

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hard-coded `EXECUTION_MEMORY_MODEL = LlmModels.Gemini25Flash` constant with dynamic resolution of the user's configured default LLM model, so execution memory operations (query normalization, distillation, evaluation) use each user's preferred model.

**Architecture:** The execution memory system currently creates three LLM clients at service startup using a hard-coded Gemini 2.5 Flash model. Since these clients are shared across all users, we need to shift to per-task client resolution during `drainTaskQueue` (for query normalization) and `processExecutionMemoryBacklog` (for distillation/evaluation). The existing `UserServiceClient.getLlmClient(userId)` already resolves the user's default model with fallback — we reuse it as the provider for execution memory LLM clients.

**Tech Stack:** TypeScript, `@intexuraos/llm-factory`, `@intexuraos/internal-clients` (UserServiceClient), `@intexuraos/llm-contract`

---

## Context: Why Is It Hard-Coded?

Execution memory was built as a system-level feature. Three LLM clients are created once at startup in `apps/code-agent/src/services.ts` (lines 95–481):

```typescript
const EXECUTION_MEMORY_MODEL = LlmModels.Gemini25Flash;  // hard-coded

const executionMemoryQueryClient = createLlmClient({
  apiKey: config.geminiAppApiKey,
  model: EXECUTION_MEMORY_MODEL,
  // ...
});
// Same for distillerClient, evaluatorClient
```

These static clients are injected into the `ServiceContainer` and passed to use cases. The user's task has a `userId` field, and `UserServiceClient.getLlmClient(userId)` already resolves the user's preferred model (with Gemini 2.5 Flash fallback). We just need to wire it through.

## Three Call Sites

| Client                           | Used In                                                                                                                                             | When                                 |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `executionMemoryQueryClient`     | `drainTaskQueue` → `prepareExecutionMemoryContext` (called from `codeRoutes.ts`, `webhookRoutes.ts`, `internalRoutes.ts`, and `drainRetryQueue.ts`) | Pre-dispatch (query normalization)   |
| `executionMemoryDistillerClient` | `internalRoutes` → `processExecutionMemoryBacklog`                                                                                                  | Post-execution (memory distillation) |
| `executionMemoryEvaluatorClient` | `internalRoutes` → `processExecutionMemoryBacklog`                                                                                                  | Post-execution (memory evaluation)   |

## Key Design Decision

**Per-task dynamic resolution, NOT per-request client creation from scratch.**

`UserServiceClient.getLlmClient(userId)` already handles:
- Fetching user settings (default model preference)
- API key resolution (user's own key or platform key)
- Pricing resolution
- Fallback to Gemini 2.5 Flash if no preference

We reuse this existing function. The static `EXECUTION_MEMORY_MODEL` constant and the three startup clients are removed. Instead, at each call site, we call `userServiceClient.getLlmClient(userId)` and pass the resulting client to the execution memory use case.

## Endpoint Changes

- **Modified:** None (no HTTP endpoint signatures change)
- **Created:** None
- **Removed:** None
- **Unchanged:** `POST /internal/drain-queue`, `POST /internal/execution-memory/process`

---

### Task 1: Remove Static Execution Memory Clients from ServiceContainer

**Files:**
- Modify: `apps/code-agent/src/services.ts:95-98` (remove `EXECUTION_MEMORY_MODEL` constant)
- Modify: `apps/code-agent/src/services.ts:140-145` (remove three optional client fields from `ServiceContainer`)
- Modify: `apps/code-agent/src/services.ts:452-481` (remove three client creation blocks)
- Modify: `apps/code-agent/src/services.ts:655-658` (remove three client assignments in return object)
- Test: All existing tests that reference these fields in `setServices()` calls

- [ ] **Step 1: Write the failing test**

Update the service container type test to verify the three execution memory client fields no longer exist. In `apps/code-agent/src/__tests__/routes/internalRoutes.test.ts`, remove the `executionMemoryDistillerClient` and `executionMemoryEvaluatorClient` from the `setServices()` mock setup. The test should fail because `ServiceContainer` still declares the fields.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/code-agent && npx vitest run src/__tests__/routes/internalRoutes.test.ts --reporter=verbose`
Expected: TypeScript compilation error or type mismatch because the fields still exist on `ServiceContainer`.

- [ ] **Step 3: Remove the constant and fields from services.ts**

In `apps/code-agent/src/services.ts`:

1. Remove line 97: `const EXECUTION_MEMORY_MODEL = LlmModels.Gemini25Flash;`
2. Remove from `ServiceContainer` interface (lines ~143-145):
   ```typescript
   executionMemoryDistillerClient?: LlmGenerateClient;
   executionMemoryEvaluatorClient?: LlmGenerateClient;
   ```
3. Remove the three `createLlmClient` blocks for execution memory (lines ~452-481):
   ```typescript
   // DELETE: executionMemoryQueryClient creation block
   // DELETE: executionMemoryDistillerClient creation block
   // DELETE: executionMemoryEvaluatorClient creation block
   ```
4. Remove the three assignments from the return object (lines ~655-658):
   ```typescript
   // DELETE: ...(executionMemoryDistillerClient !== undefined && { executionMemoryDistillerClient }),
   // DELETE: ...(executionMemoryEvaluatorClient !== undefined && { executionMemoryEvaluatorClient }),
   ```

**Keep `executionMemoryQueryClient` in `ServiceContainer` for now** — it will be replaced in Task 2 with a dynamic approach. Actually, remove it too since we'll resolve it per-task.

Wait — let's keep `executionMemoryQueryClient` in the interface but as an **optional override** for testing purposes. No — simpler to remove all three and resolve dynamically at each call site.

Remove all three client fields from `ServiceContainer`:
- `executionMemoryQueryClient?: LlmGenerateClient`
- `executionMemoryDistillerClient?: LlmGenerateClient`
- `executionMemoryEvaluatorClient?: LlmGenerateClient`

Also remove the `EXECUTION_MEMORY_USER_ID` constant (line 98) since the userId will come from the task.

- [ ] **Step 4: Run tests to verify compilation**

Run: `cd apps/code-agent && npx vitest run --reporter=verbose 2>&1 | head -100`
Expected: Multiple test files will fail with type errors referencing the removed fields. This is expected — we fix them in subsequent tasks.

- [ ] **Step 5: Fix all test files that reference removed fields**

Search for all references to the removed fields in test files:
```bash
rg "executionMemoryDistillerClient|executionMemoryEvaluatorClient|executionMemoryQueryClient" apps/code-agent/src/__tests__/ --files-with-matches
```

For each file found, remove the field assignments from `setServices()` calls. These will be replaced with per-call-site injection in Tasks 2 and 3.

- [ ] **Step 6: Commit**

```bash
git add apps/code-agent/src/services.ts apps/code-agent/src/__tests__/
git commit -m "refactor(code-agent): remove static execution memory LLM clients from ServiceContainer

Removes the hard-coded EXECUTION_MEMORY_MODEL constant and the three
startup-time LLM clients (queryClient, distillerClient, evaluatorClient).
These will be replaced with per-task dynamic resolution using the user's
default model preference."
```

---

### Task 2: Wire User Default Model into drainTaskQueue for Query Normalization

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/drainTaskQueue.ts` (add `userServiceClient` to deps, resolve LLM client per-task)
- Modify: `apps/code-agent/src/domain/usecases/prepareExecutionMemoryContext.ts:49-54` (no interface change needed — `queryClient` is already optional)
- Modify: `apps/code-agent/src/routes/internalRoutes.ts` (update where drainTaskQueue is called, pass `userServiceClient`)
- Modify: `apps/code-agent/src/routes/codeRoutes.ts` (update where drainTaskQueue is called, pass `userServiceClient`)
- Modify: `apps/code-agent/src/routes/webhookRoutes.ts` (update where drainTaskQueue is called, pass `userServiceClient`)
- Modify: `apps/code-agent/src/domain/usecases/drainRetryQueue.ts` (also calls `prepareExecutionMemoryContext` with `queryClient` — wire `userServiceClient`)
- Modify: `apps/code-agent/src/routes/codeRoutes.ts` (update where `drainRetryQueue` is called — pass `userServiceClient` in deps)
- Test: `apps/code-agent/src/__tests__/domain/usecases/drainTaskQueue.test.ts`
- Test: `apps/code-agent/src/__tests__/domain/usecases/drainRetryQueue.test.ts`
- Test: `apps/code-agent/src/__tests__/routes/codeRoutes.test.ts`

The `drainTaskQueue` use case already receives `executionMemory?: PrepareExecutionMemoryResources` in its deps (line 74). The `PrepareExecutionMemoryResources` interface includes `queryClient?: LlmGenerateClient`. Currently this queryClient comes from `ServiceContainer`. Instead, we resolve it dynamically using the task's `userId`.

- [ ] **Step 1: Write the failing test**

In the drainTaskQueue test file, add a test that verifies when a task is dispatched, the execution memory query client is resolved from `userServiceClient.getLlmClient(task.userId)` rather than using a static client.

```typescript
it('resolves execution memory query client from user default model', async () => {
  const fakeLlmClient = { generate: vi.fn().mockResolvedValue(ok({ content: '{"semanticQuery":"test","components":[],"riskFlags":[],"verificationGoals":[],"summary":"test"}', usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20, costUsd: 0.001 } })) };
  const mockUserServiceClient = {
    getLlmClient: vi.fn().mockResolvedValue(ok(fakeLlmClient)),
  };

  // ... set up deps with mockUserServiceClient instead of static executionMemory.queryClient
  // ... enqueue a task, call drainTaskQueue
  // ... assert mockUserServiceClient.getLlmClient was called with the task's userId
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/code-agent && npx vitest run src/__tests__/domain/usecases/drainTaskQueue.test.ts --reporter=verbose`
Expected: FAIL because `userServiceClient` is not yet in `DrainTaskQueueDeps`.

- [ ] **Step 3: Add userServiceClient to DrainTaskQueueDeps and resolve per-task**

In `apps/code-agent/src/domain/usecases/drainTaskQueue.ts`:

1. Add to `DrainTaskQueueDeps` interface:
   ```typescript
   userServiceClient: Pick<import('@intexuraos/internal-clients').UserServiceClient, 'getLlmClient'>;
   ```

2. After the worker settings fetch (around line 262), resolve the user's LLM client:
   ```typescript
   // Resolve user's default LLM client for execution memory
   let userLlmClient: LlmGenerateClient | undefined;
   if (config.executionMemoryEnabled && isMemoryEligibleAgent(agentType)) {
     const llmResult = await deps.userServiceClient.getLlmClient(task.userId);
     if (llmResult.ok) {
       userLlmClient = llmResult.value;
     } else {
       logger.warn(
         { userId: task.userId, error: llmResult.error },
         'Failed to resolve user LLM client for execution memory — falling back to no query normalization'
       );
     }
   }
   ```

3. Replace the static `deps.executionMemory?.queryClient` reference (line 382) with the dynamically resolved client:
   ```typescript
   queryClient: userLlmClient ?? deps.executionMemory?.queryClient,
   ```

   Actually, since we removed `queryClient` from the static ServiceContainer, simplify:
   ```typescript
   queryClient: userLlmClient,
   ```

- [ ] **Step 4: Update all call sites that pass deps to drainTaskQueue and drainRetryQueue**

In `apps/code-agent/src/routes/internalRoutes.ts`, where `drainTaskQueue` is called, add `userServiceClient: services.userServiceClient` to the deps object.

In `apps/code-agent/src/routes/codeRoutes.ts`, where `drainRetryQueue(...)` is called (the retry path after task dispatch), add `userServiceClient: services.userServiceClient` to the deps object. Without this caller change, the retry path cannot compile once the `DrainRetryQueueDeps` interface adds `userServiceClient`.

In `apps/code-agent/src/routes/webhookRoutes.ts`, where `drainTaskQueue` is called, add `userServiceClient: services.userServiceClient` to the deps object.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/code-agent && npx vitest run src/__tests__/domain/usecases/drainTaskQueue.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/code-agent/src/domain/usecases/drainTaskQueue.ts apps/code-agent/src/routes/internalRoutes.ts apps/code-agent/src/__tests__/domain/usecases/drainTaskQueue.test.ts
git commit -m "feat(code-agent): resolve execution memory query client from user default model

drainTaskQueue now calls userServiceClient.getLlmClient(task.userId) to
obtain the user's preferred LLM for execution memory query normalization
instead of using a hard-coded Gemini 2.5 Flash client."
```

---

### Task 3: Wire User Default Model into processExecutionMemoryBacklog for Distillation and Evaluation

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/processExecutionMemoryBacklog.ts` (add `userServiceClient` to deps, resolve per-task)
- Modify: `apps/code-agent/src/routes/internalRoutes.ts` (update where processExecutionMemoryBacklog is called)
- Test: `apps/code-agent/src/__tests__/domain/useCases/processExecutionMemoryBacklog.test.ts`

The backlog processor iterates over completed tasks. Each task has a `userId`. For each task, resolve the user's LLM client and use it as both the distiller and evaluator client.

- [ ] **Step 1: Write the failing test**

In the processExecutionMemoryBacklog test file, add a test that verifies the distiller and evaluator clients are resolved from the user's default model via `userServiceClient.getLlmClient()`.

```typescript
it('resolves distiller and evaluator clients from user default model', async () => {
  const fakeLlmClient = { generate: vi.fn().mockResolvedValue(ok({ content: '...', usage: { ... } })) };
  const mockUserServiceClient = {
    getLlmClient: vi.fn().mockResolvedValue(ok(fakeLlmClient)),
  };

  const result = await processExecutionMemoryBacklog({
    // ... other deps
    userServiceClient: mockUserServiceClient,
    // distillerClient and evaluatorClient are NO LONGER passed
  });

  expect(mockUserServiceClient.getLlmClient).toHaveBeenCalledWith(task.userId);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/code-agent && npx vitest run src/__tests__/domain/useCases/processExecutionMemoryBacklog.test.ts --reporter=verbose`
Expected: FAIL because `userServiceClient` is not in `ProcessExecutionMemoryBacklogDeps`.

- [ ] **Step 3: Update ProcessExecutionMemoryBacklogDeps**

In `apps/code-agent/src/domain/usecases/processExecutionMemoryBacklog.ts`:

1. Add import:
   ```typescript
   import type { UserServiceClient } from '@intexuraos/internal-clients';
   ```

2. Update `ProcessExecutionMemoryBacklogDeps`:
   ```typescript
   export interface ProcessExecutionMemoryBacklogDeps {
     // ... existing fields (logger, codeTaskRepo, etc.)
     userServiceClient: Pick<UserServiceClient, 'getLlmClient'>;
     // No evaluatorClient/distillerClient — static clients were removed in Task 1
     // ...
   }
   ```

3. In the per-task processing loop, resolve the user's client:
   ```typescript
   // For each task being processed:
   const llmResult = await deps.userServiceClient.getLlmClient(task.userId);
   if (!llmResult.ok) {
     deps.logger.warn(
       { userId: task.userId, taskId: task.id, error: llmResult.error },
       'Failed to resolve user LLM client for execution memory — skipping distillation/evaluation for this task'
     );
     continue; // skip this task's memory processing
   }
   const taskLlmClient = llmResult.value;

   // Use taskLlmClient as both evaluator and distiller
   ```

4. Update the internal functions that use `deps.evaluatorClient` and `deps.distillerClient` to accept the resolved `taskLlmClient` directly as a parameter instead.

- [ ] **Step 4: Update the call site in internalRoutes.ts**

In `apps/code-agent/src/routes/internalRoutes.ts` (around line 306), add `userServiceClient: services.userServiceClient` to the `processExecutionMemoryBacklog` call.

Remove the `executionMemoryEvaluatorClient` and `executionMemoryDistillerClient` spreads since those fields no longer exist on `ServiceContainer`.

- [ ] **Step 5: Run all tests**

Run: `cd apps/code-agent && npx vitest run --reporter=verbose`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/code-agent/src/domain/usecases/processExecutionMemoryBacklog.ts apps/code-agent/src/routes/internalRoutes.ts apps/code-agent/src/__tests__/domain/useCases/processExecutionMemoryBacklog.test.ts
git commit -m "feat(code-agent): resolve execution memory distiller/evaluator from user default model

processExecutionMemoryBacklog now resolves the user's preferred LLM via
userServiceClient.getLlmClient(task.userId) for distillation and evaluation,
instead of using the hard-coded Gemini 2.5 Flash clients."
```

---

### Task 4: Update PrepareExecutionMemoryResources Interface

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/prepareExecutionMemoryContext.ts:49-54` (simplify `PrepareExecutionMemoryResources`)
- Modify: `apps/code-agent/src/domain/usecases/drainTaskQueue.ts:74` (update type usage)
- Test: `apps/code-agent/src/__tests__/domain/useCases/prepareExecutionMemoryContext.test.ts`

After Tasks 1-3, the `queryClient` field in `PrepareExecutionMemoryResources` is no longer populated from the ServiceContainer. It's now passed directly. Clean up the interface to reflect the new pattern.

- [ ] **Step 1: Remove queryClient from PrepareExecutionMemoryResources**

The `queryClient` is now passed directly in `PrepareExecutionMemoryContextParams` (line 56-61), not via the resources object. If `PrepareExecutionMemoryResources` is still used as a grouping type in `DrainTaskQueueDeps`, update it to only contain the non-LLM resources:

```typescript
export interface PrepareExecutionMemoryResources {
  embeddingClient?: ExecutionMemoryEmbeddingClient | undefined;
  executionMemoryRepo?: Pick<ExecutionMemoryRepository, 'findNearest'> | undefined;
  executionMemoryApplicationRepo?: Pick<ExecutionMemoryApplicationRepository, 'create'> | undefined;
}
```

Remove `queryClient` from this interface since it's now resolved per-task.

- [ ] **Step 2: Run tests to verify**

Run: `cd apps/code-agent && npx vitest run --reporter=verbose`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/code-agent/src/domain/usecases/prepareExecutionMemoryContext.ts apps/code-agent/src/domain/usecases/drainTaskQueue.ts apps/code-agent/src/__tests__/domain/
git commit -m "refactor(code-agent): remove queryClient from PrepareExecutionMemoryResources

queryClient is now resolved per-task from user preferences, not from
the static ServiceContainer resources bundle."
```

---

### Task 5: Full Integration Test and CI Verification

**Files:**
- Test: All modified files
- Verify: `pnpm run ci:tracked`

- [ ] **Step 1: Run workspace verification**

```bash
pnpm run verify:workspace:tracked -- code-agent
```

Expected: PASS with 100% branch coverage

- [ ] **Step 2: Run full CI**

```bash
pnpm run ci:tracked
```

Expected: PASS

- [ ] **Step 3: Final commit if any cleanup needed**

---

## Fallback Behavior

The design preserves graceful degradation:

1. **User has a default model configured** → execution memory uses that model
2. **User has no preference** → `UserServiceClient.getLlmClient()` falls back to Gemini 2.5 Flash (existing behavior in `client.ts` line 158)
3. **User service is unreachable** → `getLlmClient` returns an error → execution memory falls back to deterministic normalization (no LLM call) for query prep, and skips distillation/evaluation for backlog processing
4. **User's API key is missing for their preferred model** → `getLlmClient` handles fallback to platform key internally

## Risk Assessment

- **Low risk:** The `UserServiceClient.getLlmClient()` path is already battle-tested for code task dispatch. We're reusing it, not building new infrastructure.
- **No data migration needed:** Model is determined at runtime, not stored.
- **Backward compatible:** Existing execution memories are model-agnostic (they store text, not model metadata).
- **Performance consideration:** Each `getLlmClient` call makes an HTTP request to user-service. For `drainTaskQueue` this is fine (one call per task). For `processExecutionMemoryBacklog` which processes batches, we may want to cache per-userId within a batch — but this is an optimization, not a blocker.
