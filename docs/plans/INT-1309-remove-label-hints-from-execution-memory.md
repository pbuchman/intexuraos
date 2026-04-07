# Remove Linear Labels from Execution Memory Scoring Pipeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the `labelHints`/`labelOverlap` signal from the execution memory scoring pipeline — it contributes near-zero value (avg 0.012 pts) and wastes 15% of the reranking weight budget.

**Architecture:** All changes are within the `code-agent` app. The label signal is threaded through four layers: model (`ExecutionMemory`), repository interfaces (`CreateExecutionMemoryInput`, `UpdateExecutionMemoryInput`), retrieval/scoring (`prepareExecutionMemoryContext`), and distillation (`processExecutionMemoryBacklog`). We remove `labelHints` from all layers and redistribute the freed 15% weight equally across the three remaining signals. Existing Firestore documents retain vestigial `labelHints` fields — no migration needed. The Firestore repository's `toExecutionMemory` mapper continues to read `labelHints` from documents but the field is no longer used in scoring.

**Tech Stack:** TypeScript, Vitest, Zod, Firestore

**Important scope note:** `linearIssueLabels` is used throughout the codebase for task routing (`resolveTaskAgentType`, `shouldFanOut`) and dispatch (`TaskDispatchParams`). Those usages are **not** part of this change. We only remove `linearIssueLabels` from the `prepareExecutionMemoryContext` call signature and its internal helpers.

---

## File Map

| Action   | File                                                                                      | Responsibility                                                                                                |
| -------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Modify   | `apps/code-agent/src/domain/models/executionMemory.ts:30`                                 | Remove `labelHints` from `ExecutionMemory` interface                                                          |
| Modify   | `apps/code-agent/src/domain/repositories/executionMemoryRepository.ts:25,53`              | Remove `labelHints` from `CreateExecutionMemoryInput` and `UpdateExecutionMemoryInput`                        |
| Modify   | `apps/code-agent/src/infra/repositories/firestoreExecutionMemoryRepository.ts:39`         | Remove `labelHints` from `toExecutionMemory` mapper                                                           |
| Modify   | `apps/code-agent/src/domain/usecases/prepareExecutionMemoryContext.ts`                    | Remove `linearIssueLabels` param, `labelHints` schema/interface, `labelOverlap` scoring, redistribute weights |
| Modify   | `apps/code-agent/src/domain/usecases/processExecutionMemoryBacklog.ts:49,316,531-532,779` | Remove `labelHints` from distillation schema, prompt, and persistence                                         |
| Modify   | `apps/code-agent/src/domain/usecases/drainTaskQueue.ts:380`                               | Remove `linearIssueLabels` arg from `prepareExecutionMemoryContext()` call                                    |
| Modify   | `apps/code-agent/src/domain/usecases/drainRetryQueue.ts:275`                              | Remove `linearIssueLabels` arg from `prepareExecutionMemoryContext()` call                                    |
| Modify   | `apps/code-agent/src/__tests__/domain/useCases/prepareExecutionMemoryContext.test.ts`     | Update all test cases to remove label-related fields and assertions                                           |
| Modify   | `apps/code-agent/src/__tests__/domain/useCases/processExecutionMemoryBacklog.test.ts`     | Remove `labelHints` from all test fixtures                                                                    |

---

## Weight Redistribution Decision

Current formula (line 419-423 of `prepareExecutionMemoryContext.ts`):
```
0.50 * vectorScore + 0.20 * componentOverlap + 0.15 * labelOverlap + 0.15 * effectiveness
```

New formula — redistribute 15% equally (+5% each):
```
0.55 * vectorScore + 0.25 * componentOverlap + 0.20 * effectiveness
```

Rationale: vectorScore and componentOverlap are the strongest differentiators per the production data analysis. Effectiveness also benefits from a small boost since it rewards battle-tested memories.

---

### Task 1: Remove `labelHints` from model and repository interfaces

**Files:**
- Modify: `apps/code-agent/src/domain/models/executionMemory.ts:30`
- Modify: `apps/code-agent/src/domain/repositories/executionMemoryRepository.ts:25,53`
- Modify: `apps/code-agent/src/infra/repositories/firestoreExecutionMemoryRepository.ts:39`

- [ ] **Step 1: Remove `labelHints` from `ExecutionMemory` interface**

In `apps/code-agent/src/domain/models/executionMemory.ts`, delete line 30:
```typescript
// DELETE this line:
  labelHints: string[];
```

The interface should go from `keywords → labelHints → componentHints` to `keywords → componentHints`.

- [ ] **Step 2: Remove `labelHints` from `CreateExecutionMemoryInput`**

In `apps/code-agent/src/domain/repositories/executionMemoryRepository.ts`, delete line 25:
```typescript
// DELETE this line:
  labelHints: string[];
```

- [ ] **Step 3: Remove `labelHints` from `UpdateExecutionMemoryInput`**

In the same file, delete line 53:
```typescript
// DELETE this line:
  labelHints?: string[];
```

- [ ] **Step 4: Remove `labelHints` from `toExecutionMemory` mapper**

In `apps/code-agent/src/infra/repositories/firestoreExecutionMemoryRepository.ts`, delete line 39:
```typescript
// DELETE this line:
    labelHints: Array.isArray(data['labelHints']) ? data['labelHints'] as string[] : [],
```

- [ ] **Step 5: Verify TypeScript compilation**

Run: `cd /repo && pnpm build --filter code-agent 2>&1 | head -50`

Expected: Build errors in downstream files that still reference `labelHints` — this confirms the type removal is propagating correctly. We'll fix these in subsequent tasks.

- [ ] **Step 6: Commit**

```bash
git add apps/code-agent/src/domain/models/executionMemory.ts apps/code-agent/src/domain/repositories/executionMemoryRepository.ts apps/code-agent/src/infra/repositories/firestoreExecutionMemoryRepository.ts
git commit -m "refactor(code-agent): remove labelHints from ExecutionMemory model and repository interfaces

Chiseled with love by <a href=\"mailto:intex@intexuraos.cloud\">Intex</a>"
```

---

### Task 2: Remove label signal from scoring/retrieval pipeline

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/prepareExecutionMemoryContext.ts`
- Test: `apps/code-agent/src/__tests__/domain/useCases/prepareExecutionMemoryContext.test.ts`

- [ ] **Step 1: Update tests first — remove `labelHints` from all test normalization mocks and assertions**

In `prepareExecutionMemoryContext.test.ts`:

1. Remove `labelHints` from every `queryClient.generate.mockResolvedValue` JSON payload (lines ~134, 226, 313, 349, 608, 667). The LLM mock responses should no longer include `labelHints`.

2. Remove `linearIssueLabels` from every `prepareExecutionMemoryContext()` call. The parameter no longer exists. Remove lines like:
```typescript
// DELETE from every call:
      linearIssueLabels: ['backend', 'bug'],
```

3. Remove `labelHints` from `createMatch()` default (line 109):
```typescript
// DELETE this line from createMatch:
      labelHints: ['bug', 'backend'],
```

4. Remove `labelOverlap` from observability test assertions (lines ~650, 707):
```typescript
// DELETE this line from topCandidates assertions:
            labelOverlap: 0,
// and:
            labelOverlap: 1,
```

5. Update the `buildFallbackNormalization` test (line 483-498). Remove the third argument `[' Backend ', 'backend', '']` and remove `labelHints` from the expected output:
```typescript
const fallback = prepareExecutionMemoryContextTestables.buildFallbackNormalization(
  {
    prompt: '  Prompt fallback  ',
    sanitizedPrompt: '   ',
  },
  { description: null, comments: [] }
);
expect(fallback).toEqual({
  semanticQuery: 'Prompt fallback',
  components: [],
  riskFlags: [],
  verificationGoals: [],
  summary: 'Prompt fallback',
});
```

6. Update the `normalizeQuery` test (line 500-512). Remove `linearIssueLabels` from the call:
```typescript
const invalidNormalization = await prepareExecutionMemoryContextTestables.normalizeQuery({
  task: {
    prompt: 'Prompt fallback',
    sanitizedPrompt: 'Prompt fallback',
  },
  issueContext: { description: null, comments: [] },
  logger,
  queryClient: {
    generate: vi.fn().mockResolvedValue(ok({ content: 'missing braces' })),
  } as never,
});
```

7. Update the `rerankMemories` test (line 555-570). Remove `labelHints` from test match fixtures, normalization objects, and the third argument:
```typescript
const reranked = prepareExecutionMemoryContextTestables.rerankMemories(
  [
    createMatch('mem-1', { vectorScore: 0.9, componentHints: [] }),
    createMatch('mem-2', { vectorScore: 0.7, componentHints: ['route'] }),
  ],
  {
    semanticQuery: 'route verification',
    components: [],
    riskFlags: [],
    verificationGoals: [],
    summary: 'summary',
  }
);
```

8. Update the weight calculation test (line 576-601). Remove `labelHints` from the normalization and match fixture, remove the third arg, and update the expected score calculation:
```typescript
it('scores candidates using rebalanced weights without label signal', () => {
  const reranked = prepareExecutionMemoryContextTestables.rerankMemories(
    [
      createMatch('mem-moderate', {
        vectorScore: 0.75,
        componentHints: ['auth', 'route', 'logging'],
        applicationCount: 0,
        positiveCount: 0,
      }),
    ],
    {
      semanticQuery: 'auth route logging verification',
      components: ['auth', 'route', 'logging', 'verification'],
      riskFlags: [],
      verificationGoals: [],
      summary: 'summary',
    }
  );

  // New weights: 0.55*0.75 + 0.25*(3/4) + 0.20*((0+1)/(0+2))
  // = 0.4125 + 0.1875 + 0.10 = 0.70
  expect(reranked[0]?.rerankScore).toBeCloseTo(0.70, 2);
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/useCases/prepareExecutionMemoryContext.test.ts 2>&1 | tail -30`

Expected: FAIL — tests reference removed fields/params.

- [ ] **Step 3: Remove `labelHints` from `QueryNormalizationSchema` and `QueryNormalization` interface**

In `prepareExecutionMemoryContext.ts`:

Delete line 27 from `QueryNormalizationSchema`:
```typescript
// DELETE:
  labelHints: z.array(z.string()).default([]),
```

Delete line 36 from `QueryNormalization`:
```typescript
// DELETE:
  labelHints: string[];
```

- [ ] **Step 4: Remove `linearIssueLabels` from `PrepareExecutionMemoryContextParams`**

Delete line 53:
```typescript
// DELETE:
  linearIssueLabels: string[];
```

- [ ] **Step 5: Remove `linearIssueLabels` from function body destructuring**

In `prepareExecutionMemoryContext()` (line 63), remove `linearIssueLabels` from the destructuring:
```typescript
// BEFORE:
  const {
    task,
    linearIssueLabels,
    logger,
    ...
  } = params;

// AFTER:
  const {
    task,
    logger,
    ...
  } = params;
```

- [ ] **Step 6: Remove `linearIssueLabels` from `normalizeQuery()` call and signature**

Update line 73-79 — remove `linearIssueLabels` from the call:
```typescript
const normalization = await normalizeQuery({
  task,
  issueContext,
  logger,
  queryClient,
});
```

Update `normalizeQuery` function signature (line 306-312) — remove `linearIssueLabels` parameter:
```typescript
async function normalizeQuery(params: {
  task: Pick<CodeTask, 'prompt' | 'sanitizedPrompt'>;
  issueContext: { description: string | null; comments: string[] };
  logger: Logger;
  queryClient?: LlmGenerateClient | undefined;
}): Promise<QueryNormalization> {
```

Update `buildFallbackNormalization` call (line 313-317) — remove third argument:
```typescript
const fallback = buildFallbackNormalization(
  params.task,
  params.issueContext
);
```

Update `buildNormalizationPrompt` call (line 323-327) — remove third argument:
```typescript
const normalizationPrompt = buildNormalizationPrompt(
  params.task,
  params.issueContext
);
```

- [ ] **Step 7: Remove `linearIssueLabels` from `buildFallbackNormalization()`**

Update function signature (line 350-354) — remove third parameter:
```typescript
function buildFallbackNormalization(
  task: Pick<CodeTask, 'prompt' | 'sanitizedPrompt'>,
  issueContext: { description: string | null; comments: string[] }
): QueryNormalization {
```

Remove `labelHints` from the return object (line 371):
```typescript
// DELETE:
    labelHints: dedupeLower(linearIssueLabels),
```

- [ ] **Step 8: Remove `linearIssueLabels` from `buildNormalizationPrompt()`**

Update function signature (line 376-379) — remove third parameter:
```typescript
function buildNormalizationPrompt(
  task: Pick<CodeTask, 'prompt' | 'sanitizedPrompt'>,
  issueContext: { description: string | null; comments: string[] }
): string {
```

Remove line 390 from the prompt array:
```typescript
// DELETE:
    `Linear labels:\n${linearIssueLabels.join(', ')}`,
```

Remove `"labelHints":["string"]` from the schema description (line 397):
```typescript
// BEFORE:
    '{"semanticQuery":"string","components":["string"],"riskFlags":["string"],"verificationGoals":["string"],"labelHints":["string"],"summary":"string"}',
// AFTER:
    '{"semanticQuery":"string","components":["string"],"riskFlags":["string"],"verificationGoals":["string"],"summary":"string"}',
```

- [ ] **Step 9: Remove `linearIssueLabels` from `rerankMemories()` and update weights**

Update function signature (line 401-406) — remove `linearIssueLabels` parameter:
```typescript
function rerankMemories(
  candidates: ...,
  normalization: QueryNormalization
): { ... }[] {
```

Remove `queryLabels` computation (line 412):
```typescript
// DELETE:
  const queryLabels = dedupeLower([...linearIssueLabels, ...normalization.labelHints]);
```

Update the scoring formula (lines 416-423):
```typescript
// BEFORE:
      const componentOverlap = overlapRatio(queryComponents, memory.componentHints);
      const labelOverlap = overlapRatio(queryLabels, memory.labelHints);
      const effectiveness = (memory.positiveCount + 1) / (memory.applicationCount + 2);
      const rerankScore =
        (0.50 * memory.vectorScore)
        + (0.20 * componentOverlap)
        + (0.15 * labelOverlap)
        + (0.15 * effectiveness);

// AFTER:
      const componentOverlap = overlapRatio(queryComponents, memory.componentHints);
      const effectiveness = (memory.positiveCount + 1) / (memory.applicationCount + 2);
      const rerankScore =
        (0.55 * memory.vectorScore)
        + (0.25 * componentOverlap)
        + (0.20 * effectiveness);
```

Update the call site (line 175) — remove `linearIssueLabels` argument:
```typescript
// BEFORE:
  const reranked = rerankMemories(nearestResult.value, normalization, linearIssueLabels);
// AFTER:
  const reranked = rerankMemories(nearestResult.value, normalization);
```

- [ ] **Step 10: Remove `labelOverlap` from observability log**

Update the `topCandidates` mapper (lines 181-194):
```typescript
// BEFORE:
  const queryComponents = dedupeLower(normalization.components);
  const queryLabels = dedupeLower([...linearIssueLabels, ...normalization.labelHints]);
  const topCandidates = reranked.slice(0, TOP_LOG_CANDIDATES).map((candidate) => ({
    memoryId: candidate.memory.id,
    title: candidate.memory.title,
    rerankScore: roundScore(candidate.rerankScore),
    vectorScore: candidate.memory.vectorScore,
    componentOverlap: roundScore(overlapRatio(queryComponents, candidate.memory.componentHints)),
    labelOverlap: roundScore(overlapRatio(queryLabels, candidate.memory.labelHints)),
    effectiveness: roundScore(
      (candidate.memory.positiveCount + 1) / (candidate.memory.applicationCount + 2)
    ),
    passedThreshold: candidate.rerankScore >= MIN_RERANK_SCORE,
  }));

// AFTER:
  const queryComponents = dedupeLower(normalization.components);
  const topCandidates = reranked.slice(0, TOP_LOG_CANDIDATES).map((candidate) => ({
    memoryId: candidate.memory.id,
    title: candidate.memory.title,
    rerankScore: roundScore(candidate.rerankScore),
    vectorScore: candidate.memory.vectorScore,
    componentOverlap: roundScore(overlapRatio(queryComponents, candidate.memory.componentHints)),
    effectiveness: roundScore(
      (candidate.memory.positiveCount + 1) / (candidate.memory.applicationCount + 2)
    ),
    passedThreshold: candidate.rerankScore >= MIN_RERANK_SCORE,
  }));
```

- [ ] **Step 11: Bump `RETRIEVAL_VERSION`**

Update line 13:
```typescript
// BEFORE:
const RETRIEVAL_VERSION = 'execution-memory-retrieval@2.0.0';
// AFTER:
const RETRIEVAL_VERSION = 'execution-memory-retrieval@3.0.0';
```

- [ ] **Step 12: Update retrieval version in test assertions**

In `prepareExecutionMemoryContext.test.ts`, find-and-replace all occurrences:
```
'execution-memory-retrieval@2.0.0' → 'execution-memory-retrieval@3.0.0'
```

- [ ] **Step 13: Run tests to verify they pass**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/useCases/prepareExecutionMemoryContext.test.ts 2>&1 | tail -30`

Expected: ALL PASS

- [ ] **Step 14: Commit**

```bash
git add apps/code-agent/src/domain/usecases/prepareExecutionMemoryContext.ts apps/code-agent/src/__tests__/domain/useCases/prepareExecutionMemoryContext.test.ts
git commit -m "refactor(code-agent): remove label signal from execution memory scoring pipeline

Remove labelHints/labelOverlap from reranking formula and redistribute
15% weight equally: vectorScore 0.50→0.55, componentOverlap 0.20→0.25,
effectiveness 0.15→0.20. Bump RETRIEVAL_VERSION to 3.0.0.

Chiseled with love by <a href=\"mailto:intex@intexuraos.cloud\">Intex</a>"
```

---

### Task 3: Remove label signal from distillation pipeline

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/processExecutionMemoryBacklog.ts`
- Test: `apps/code-agent/src/__tests__/domain/useCases/processExecutionMemoryBacklog.test.ts`

- [ ] **Step 1: Update tests first — remove `labelHints` from all test fixtures**

In `processExecutionMemoryBacklog.test.ts`, remove `labelHints` from every test fixture where it appears. There are ~12 occurrences at lines 239, 1052, 1101, 1131, 1145, 1319, 1413, 1814, 1877, 1935, 2066. Each is a line like:
```typescript
// DELETE each occurrence:
      labelHints: [],
// or:
      labelHints: ['backend'],
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/useCases/processExecutionMemoryBacklog.test.ts 2>&1 | tail -30`

Expected: FAIL — test fixtures include `labelHints` which no longer exists in the schema.

- [ ] **Step 3: Remove `labelHints` from `DistillationSchema`**

In `processExecutionMemoryBacklog.ts`, delete line 49 from the schema:
```typescript
// DELETE:
    labelHints: z.array(z.string()).default([]),
```

- [ ] **Step 4: Remove `labelHints` from distillation prompt guidance**

Find lines 531-532 in the prompt array and delete the `labelHints` guidance line:
```typescript
// DELETE:
      '      "labelHints": ["string (Linear issue labels this applies to, e.g. bug, backend, frontend)"],',
```

Also remove `"labelHints":["string"]` from any schema description string in the prompt.

- [ ] **Step 5: Remove `labelHints` from memory persistence (two locations)**

At line 316 (new memory creation):
```typescript
// DELETE:
      labelHints: memory.labelHints,
```

At line 779 (memory update/merge):
```typescript
// DELETE:
      labelHints: memory.labelHints,
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/useCases/processExecutionMemoryBacklog.test.ts 2>&1 | tail -30`

Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add apps/code-agent/src/domain/usecases/processExecutionMemoryBacklog.ts apps/code-agent/src/__tests__/domain/useCases/processExecutionMemoryBacklog.test.ts
git commit -m "refactor(code-agent): remove labelHints from execution memory distillation pipeline

Chiseled with love by <a href=\"mailto:intex@intexuraos.cloud\">Intex</a>"
```

---

### Task 4: Remove `linearIssueLabels` from `prepareExecutionMemoryContext` callers

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/drainTaskQueue.ts:380`
- Modify: `apps/code-agent/src/domain/usecases/drainRetryQueue.ts:275`

**Important:** `linearIssueLabels` is still used in these files for task routing (`resolveTaskAgentType`, `shouldFanOut`) and dispatch (`linearIssueLabels: dispatchLabels`). Only remove it from the `prepareExecutionMemoryContext()` call.

- [ ] **Step 1: Remove `linearIssueLabels` from `prepareExecutionMemoryContext` call in `drainTaskQueue.ts`**

At line 380, remove the `linearIssueLabels: dispatchLabels` property:
```typescript
// BEFORE (line ~377-386):
      taskExecutionMemoryContext = await prepareExecutionMemoryContext({
        task,
        linearIssueLabels: dispatchLabels,
        logger,
        linearAgentClient,
        queryClient: deps.executionMemory?.queryClient,
        ...
      });

// AFTER:
      taskExecutionMemoryContext = await prepareExecutionMemoryContext({
        task,
        logger,
        linearAgentClient,
        queryClient: deps.executionMemory?.queryClient,
        ...
      });
```

- [ ] **Step 2: Remove `linearIssueLabels` from `prepareExecutionMemoryContext` call in `drainRetryQueue.ts`**

At line 275, same change:
```typescript
// BEFORE (line ~273-278):
    taskExecutionMemoryContext = await prepareExecutionMemoryContext({
      task,
      linearIssueLabels: dispatchLabels,
      logger,
      linearAgentClient,
      ...
    });

// AFTER:
    taskExecutionMemoryContext = await prepareExecutionMemoryContext({
      task,
      logger,
      linearAgentClient,
      ...
    });
```

- [ ] **Step 3: Verify TypeScript compilation succeeds**

Run: `cd /repo && pnpm build --filter code-agent 2>&1 | tail -20`

Expected: BUILD SUCCESS — no more type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/code-agent/src/domain/usecases/drainTaskQueue.ts apps/code-agent/src/domain/usecases/drainRetryQueue.ts
git commit -m "refactor(code-agent): remove linearIssueLabels from prepareExecutionMemoryContext callers

Chiseled with love by <a href=\"mailto:intex@intexuraos.cloud\">Intex</a>"
```

---

### Task 5: Full CI verification

- [ ] **Step 1: Run workspace verification**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent 2>&1 | tee /tmp/ci-output-1309.txt | tail -50`

Expected: ALL PASS

- [ ] **Step 2: Run full CI**

Run: `cd /repo && pnpm run ci:tracked 2>&1 | tee /tmp/ci-output-1309-full.txt | tail -50`

Expected: ALL PASS

- [ ] **Step 3: If failures, capture and fix**

Run: `rg "error|FAIL" -C3 /tmp/ci-output-1309-full.txt`

Fix any issues, re-run CI, and commit fixes.

---

## Endpoint Changes

- Modified: None
- Created: None
- Removed: None
- Unchanged: All existing endpoints

This is a pure internal refactoring — no HTTP endpoint changes.

## Existing Data Migration

No migration required. The `labelHints` field on 563 existing active memories in Firestore becomes vestigial — the field is simply ignored during retrieval and scoring. A future cleanup migration can remove it if desired.
