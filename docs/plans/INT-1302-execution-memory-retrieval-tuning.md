# Execution Memory Retrieval Tuning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix agents failing to retrieve execution memories by lowering the rerank threshold, rebalancing scoring weights, adding observability logging, and improving componentHints quality in distillation prompts.

**Architecture:** The execution memory system has two pipelines: (1) retrieval — normalizes a query, embeds it, performs vector search, reranks candidates, and filters by threshold; (2) generation — distills completed tasks into reusable memories with componentHints/labelHints for future retrieval. The problem is the reranking formula over-weights raw vector similarity (0.65) while the `MIN_RERANK_SCORE` threshold (0.68) is too strict, causing zero memories to be injected across 20+ consecutive tasks. All changes are in `apps/code-agent`.

**Tech Stack:** TypeScript, Vitest, Zod, Firestore vector search (COSINE distance)

---

## Background: Why Memories Are Not Being Retrieved

The retrieval pipeline runs correctly but consistently fails to find memories above the minimum rerank threshold. The reranking formula is:

```
rerankScore = (0.65 x vectorScore) + (0.15 x componentOverlap) + (0.10 x labelOverlap) + (0.10 x effectiveness)
```

For a memory with zero component/label overlap and default effectiveness (0.5), the required vector score is `(0.68 - 0.05) / 0.65 = 0.969` — nearly identical embeddings. Even with moderate overlap, the bar remains extremely high. Additionally, no diagnostic logging exists to observe near-miss candidates, making the problem invisible.

## File Map

| File                                                                                  | Action   | Responsibility                                                        |
| ------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------- |
| `apps/code-agent/src/domain/usecases/prepareExecutionMemoryContext.ts`                | Modify   | Lower threshold, rebalance weights, add logging, bump version         |
| `apps/code-agent/src/__tests__/domain/useCases/prepareExecutionMemoryContext.test.ts` | Modify   | Update version strings, add logging tests, verify weight behavior     |
| `apps/code-agent/src/domain/usecases/processExecutionMemoryBacklog.ts`                | Modify   | Improve componentHints guidance in distillation prompts, bump version |
| `apps/code-agent/src/__tests__/domain/useCases/processExecutionMemoryBacklog.test.ts` | Modify   | Update distillation version strings in assertions                     |

## Endpoint Changes

- **Modified:** None
- **Created:** None
- **Removed:** None
- **Unchanged:** All existing endpoints; these changes affect internal retrieval logic only

---

### Task 1: Lower MIN_RERANK_SCORE and rebalance reranking weights (TDD)

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/prepareExecutionMemoryContext.ts:12-19,391-395`
- Test: `apps/code-agent/src/__tests__/domain/useCases/prepareExecutionMemoryContext.test.ts`

**Rationale:** The current weights over-index on raw vector similarity (0.65), making component/label overlap nearly irrelevant. Rebalancing to 0.50/0.20/0.15/0.15 means topical matches (componentHints, labels) have meaningful influence. Lowering the threshold from 0.68 to 0.55 matches the new score distribution — a memory with 0.85 vector score and moderate overlap now scores ~0.60, passing the threshold.

- [ ] **Step 1: Write a failing test for the new reranking weights**

Add a test that verifies a memory with moderate vector score (0.75) but high component/label overlap passes the new threshold. Under the old weights, `0.65*0.75 + 0.15*0.75 + 0.10*1.0 + 0.10*0.6 = 0.7575` passes old threshold but the test should assert the new score calculation is correct.

```typescript
it('scores candidates using rebalanced weights that increase component and label influence', () => {
  const reranked = prepareExecutionMemoryContextTestables.rerankMemories(
    [
      createMatch('mem-moderate', {
        vectorScore: 0.75,
        componentHints: ['auth', 'route', 'logging'],
        labelHints: ['bug', 'backend'],
        applicationCount: 0,
        positiveCount: 0,
      }),
    ],
    {
      semanticQuery: 'auth route logging verification',
      components: ['auth', 'route', 'logging', 'verification'],
      riskFlags: [],
      verificationGoals: [],
      labelHints: ['bug'],
      summary: 'summary',
    },
    ['backend', 'bug']
  );

  // New weights: 0.50*0.75 + 0.20*(3/4) + 0.15*(2/2) + 0.15*((0+1)/(0+2))
  // = 0.375 + 0.15 + 0.15 + 0.075 = 0.75
  expect(reranked[0]?.rerankScore).toBeCloseTo(0.75, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/useCases/prepareExecutionMemoryContext.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL — the old weights produce a different score (0.65*0.75 + 0.15*0.75 + 0.10*1.0 + 0.10*0.5 = 0.7475, not 0.75).

- [ ] **Step 3: Update constants and reranking formula**

In `apps/code-agent/src/domain/usecases/prepareExecutionMemoryContext.ts`, change:

```typescript
// Line 12-13: bump retrieval version (major: behavior change)
const QUERY_NORMALIZER_VERSION = 'execution-memory-query-normalizer@1.0.0';
const RETRIEVAL_VERSION = 'execution-memory-retrieval@2.0.0';
```

```typescript
// Line 18: lower threshold
const MIN_RERANK_SCORE = 0.55;
```

```typescript
// Lines 391-395: rebalance weights
const rerankScore =
  (0.50 * memory.vectorScore)
  + (0.20 * componentOverlap)
  + (0.15 * labelOverlap)
  + (0.15 * effectiveness);
```

- [ ] **Step 4: Update all RETRIEVAL_VERSION assertions in tests**

In `apps/code-agent/src/__tests__/domain/useCases/prepareExecutionMemoryContext.test.ts`, replace all occurrences of `'execution-memory-retrieval@1.0.0'` with `'execution-memory-retrieval@2.0.0'`.

- [ ] **Step 5: Run all tests to verify they pass**

```bash
cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/useCases/prepareExecutionMemoryContext.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: ALL PASS. The existing test data is designed so that high-scoring memories still pass and low-scoring ones still fail under both weight configurations.

- [ ] **Step 6: Commit**

```bash
git add apps/code-agent/src/domain/usecases/prepareExecutionMemoryContext.ts apps/code-agent/src/__tests__/domain/useCases/prepareExecutionMemoryContext.test.ts
git commit -m "fix(code-agent): lower rerank threshold to 0.55 and rebalance scoring weights

Reduces vectorScore weight from 0.65 to 0.50 and increases
componentOverlap (0.20), labelOverlap (0.15), and effectiveness (0.15)
so that topical matches have meaningful influence on retrieval.
Lowers MIN_RERANK_SCORE from 0.68 to 0.55 to match the new
score distribution. Bumps RETRIEVAL_VERSION to 2.0.0."
```

---

### Task 2: Add observability logging for near-miss candidates

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/prepareExecutionMemoryContext.ts:57-213`
- Test: `apps/code-agent/src/__tests__/domain/useCases/prepareExecutionMemoryContext.test.ts`

**Rationale:** Currently, `prepareExecutionMemoryContext` doesn't log vector search results or rerank scores, making it impossible to see how close near-misses are. Logging the top-3 candidates (whether or not they pass the threshold) provides essential diagnostic data.

- [ ] **Step 1: Write a failing test for observability logging**

Add a test that asserts `logger.info` is called with a structured log entry containing top candidates and their rerank score breakdown, even when no candidate passes the threshold.

```typescript
it('logs top-3 reranked candidates with score breakdowns even when none pass the threshold', async () => {
  queryClient.generate.mockResolvedValue(ok({
    content: JSON.stringify({
      semanticQuery: 'unrelated topic query',
      components: ['unrelated'],
      riskFlags: [],
      verificationGoals: [],
      labelHints: [],
      summary: 'Unrelated topic',
    }),
    usage: { model: LlmModels.Gemini25Flash },
  }));

  embeddingClient.embed.mockResolvedValue(ok([0.1, 0.2, 0.3]));
  executionMemoryRepo.findNearest.mockResolvedValue(ok([
    createMatch('mem-near-miss', {
      vectorScore: 0.70,
      componentHints: [],
      labelHints: [],
      applicationCount: 0,
      positiveCount: 0,
    }),
  ]));
  executionMemoryApplicationRepo.create.mockResolvedValue(ok({ id: 'app-near' }));

  await prepareExecutionMemoryContext({
    task: createTask(),
    linearIssueLabels: [],
    logger,
    linearAgentClient: linearAgentClient as never,
    queryClient: queryClient as never,
    embeddingClient: embeddingClient as never,
    executionMemoryRepo: executionMemoryRepo as never,
    executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
  });

  expect(logger.info).toHaveBeenCalledWith(
    expect.objectContaining({
      taskId: 'task-123',
      candidateCount: 1,
      matchedCount: 0,
      topCandidates: expect.arrayContaining([
        expect.objectContaining({
          memoryId: 'mem-near-miss',
          rerankScore: expect.any(Number),
          vectorScore: 0.70,
        }),
      ]),
    }),
    expect.stringContaining('Execution memory reranking complete')
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/useCases/prepareExecutionMemoryContext.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL — no `logger.info` call with reranking details exists yet.

- [ ] **Step 1b: Write a failing test for observability logging on the match path**

Add a test that asserts `logger.info` is called with a structured log entry when candidates DO pass the threshold. This verifies the logging works on the success path, not just the no-match path.

```typescript
it('logs top-3 reranked candidates with score breakdowns when memories ARE matched', async () => {
  queryClient.generate.mockResolvedValue(ok({
    content: JSON.stringify({
      semanticQuery: 'auth route logging verification',
      components: ['auth', 'route', 'logging', 'verification'],
      riskFlags: [],
      verificationGoals: [],
      labelHints: ['bug'],
      summary: 'Auth route logging verification',
    }),
    usage: { model: LlmModels.Gemini25Flash },
  }));

  embeddingClient.embed.mockResolvedValue(ok([0.1, 0.2, 0.3]));
  executionMemoryRepo.findNearest.mockResolvedValue(ok([
    createMatch('mem-match', {
      vectorScore: 0.95,
      componentHints: ['auth', 'route', 'logging', 'verification'],
      labelHints: ['bug', 'backend'],
      applicationCount: 2,
      positiveCount: 2,
    }),
  ]));
  executionMemoryApplicationRepo.create.mockResolvedValue(ok({ id: 'app-match' }));

  await prepareExecutionMemoryContext({
    task: createTask(),
    linearIssueLabels: ['backend', 'bug'],
    logger,
    linearAgentClient: linearAgentClient as never,
    queryClient: queryClient as never,
    embeddingClient: embeddingClient as never,
    executionMemoryRepo: executionMemoryRepo as never,
    executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
  });

  expect(logger.info).toHaveBeenCalledWith(
    expect.objectContaining({
      taskId: 'task-123',
      candidateCount: 1,
      matchedCount: 1,
      topCandidates: expect.arrayContaining([
        expect.objectContaining({
          memoryId: 'mem-match',
          rerankScore: expect.any(Number),
          vectorScore: 0.95,
          passedThreshold: true,
        }),
      ]),
    }),
    expect.stringContaining('Execution memory reranking complete')
  );
});
```

- [ ] **Step 3: Add observability logging after reranking**

In `apps/code-agent/src/domain/usecases/prepareExecutionMemoryContext.ts`, after line 177 (after filtering by `MIN_RERANK_SCORE`), add logging:

```typescript
  const reranked = rerankMemories(nearestResult.value, normalization, linearIssueLabels);
  const matchedMemories = reranked
    .filter((candidate) => candidate.rerankScore >= MIN_RERANK_SCORE)
    .slice(0, MAX_MATCHES);

  // Observability: log top candidates with score breakdowns
  const topCandidates = reranked.slice(0, MAX_MATCHES).map((candidate) => {
    const queryComponents = dedupeLower(normalization.components);
    const queryLabels = dedupeLower([...linearIssueLabels, ...normalization.labelHints]);
    return {
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
    };
  });

  logger.info(
    {
      taskId: task.id,
      candidateCount: reranked.length,
      matchedCount: matchedMemories.length,
      minRerankScore: MIN_RERANK_SCORE,
      topCandidates,
    },
    'Execution memory reranking complete'
  );
```

- [ ] **Step 4: Run all tests to verify they pass**

```bash
cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/useCases/prepareExecutionMemoryContext.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/usecases/prepareExecutionMemoryContext.ts apps/code-agent/src/__tests__/domain/useCases/prepareExecutionMemoryContext.test.ts
git commit -m "feat(code-agent): add observability logging for execution memory reranking

Logs top-3 reranked candidates with vectorScore, componentOverlap,
labelOverlap, effectiveness, and final rerankScore even when no
candidate passes the threshold. Enables diagnosing near-misses
that were previously invisible."
```

---

### Task 3: Improve componentHints quality in distillation prompts

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/processExecutionMemoryBacklog.ts:14-16,514-543`
- Test: `apps/code-agent/src/__tests__/domain/useCases/processExecutionMemoryBacklog.test.ts`

**Rationale:** The distillation schema block only shows `"componentHints": ["string"]` without guidance on what to include. The result is narrow, inconsistent labels (e.g., `"testing"`, `"orchestrator"`) that don't overlap with query components (e.g., `"code-agent service"`, `"Firestore"`). Adding explicit guidance about using canonical, aligned vocabulary dramatically improves component overlap scores.

- [ ] **Step 1: Write a test that verifies the distillation schema block contains componentHints guidance**

Add a test or update an existing prompt-content test to assert that `DISTILLATION_SCHEMA_BLOCK` includes guidance text for componentHints. Since the schema block is a module-level constant, test it indirectly through the prompt builders.

If there is no existing test that checks prompt content for componentHints guidance, add one that calls the distillation flow with a mock and asserts the prompt passed to the distiller contains the componentHints guidance string.

The key assertion: the prompt sent to the distiller client must contain a substring like `"componentHints should"` or `"Use canonical service"`.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/useCases/processExecutionMemoryBacklog.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL — the current DISTILLATION_SCHEMA_BLOCK doesn't contain componentHints guidance.

- [ ] **Step 3: Update DISTILLATION_SCHEMA_BLOCK with componentHints guidance**

In `apps/code-agent/src/domain/usecases/processExecutionMemoryBacklog.ts`, update the `DISTILLATION_SCHEMA_BLOCK` constant. Replace the existing `'      "componentHints": ["string"],'` line (line 532) and add guidance after the schema block, before the examples:

```typescript
const DISTILLATION_SCHEMA_BLOCK = [
  'Return JSON only. Use this exact schema:',
  '{',
  '  "decision": "create" | "skip",',
  '  "skipReason": "infra_only" | "insufficient_signal" | "already_completed" | "no_reusable_lesson" | "planning_unclear",  // required when decision is "skip"',
  '  "evidenceSummary": "string (non-empty, summarize what happened)",',
  '  "memories": [  // empty array when decision is "skip"',
  '    {',
  '      "memoryType": "implementation_pattern" | "verification_pattern" | "pitfall_pattern" | "decomposition_pattern" | "planning_decision" | "review_finding",',
  '      "title": "string (short descriptive title)",',
  '      "appliesWhen": "string (when this memory should be applied)",',
  '      "action": "string (what to do)",',
  '      "avoid": "string (what to avoid)",',
  '      "verification": "string (how to verify correctness)",',
  '      "evidenceSummary": "string (evidence from this task)",',
  '      "retrievalText": "string (text used for semantic search matching)",',
  '      "keywords": ["string"],',
  '      "labelHints": ["string (Linear issue labels this applies to, e.g. bug, backend, frontend)"],',
  '      "componentHints": ["string (canonical service/module names this applies to)"],',
  '      "confidence": 0.0 to 1.0',
  '    }',
  '  ]',
  '}',
  '',
  'componentHints guidance:',
  '- Use canonical service and module names from the codebase: code-agent, orchestrator, web-app,',
  '  task-router, auth, firestore, pubsub, linear, llm-factory, common-core, infra-firestore.',
  '- Use concise single-word or hyphenated identifiers, NOT multi-word phrases.',
  '- Include both the specific service (e.g. "code-agent") and the domain area (e.g. "testing",',
  '  "routing", "memory", "prompt", "ci", "migration", "schema").',
  '- Aim for 3-6 hints per memory. More hints = higher chance of matching future queries.',
  '- BAD: ["testing"] (too generic), ["code-agent service execution memory"] (too long).',
  '- GOOD: ["code-agent", "memory", "retrieval", "firestore", "testing"].',
  '',
  'Example (skip):',
  '{"decision":"skip","skipReason":"no_reusable_lesson","evidenceSummary":"Task was a trivial typo fix with no reusable pattern.","memories":[]}',
  '',
  'Example (create):',
  '{"decision":"create","evidenceSummary":"Discovered that route handlers need serialization tests.","memories":[{"memoryType":"verification_pattern","title":"Verify route serialization","appliesWhen":"Modifying route handlers","action":"Add app.inject tests for response shape","avoid":"Skipping serialization checks","verification":"Run route tests and check response schema","evidenceSummary":"Route handler returned wrong shape without test coverage","retrievalText":"route handler serialization verification test coverage","keywords":["route","serialization"],"labelHints":["testing","backend"],"componentHints":["code-agent","routing","testing","fastify"],"confidence":0.85}]}',
].join('\n');
```

Note the key changes:
1. `labelHints` schema line now has descriptive parenthetical: `"string (Linear issue labels...)"`
2. `componentHints` schema line now has descriptive parenthetical: `"string (canonical service/module names...)"`
3. New `componentHints guidance:` block with canonical vocabulary, format rules, and good/bad examples
4. Updated the create example to use richer componentHints: `["code-agent","routing","testing","fastify"]` instead of `["api"]`

- [ ] **Step 4: Bump distillation version constants**

In `apps/code-agent/src/domain/usecases/processExecutionMemoryBacklog.ts`, bump the version constants (minor bump — improved prompt guidance, not breaking):

```typescript
const DISTILLATION_VERSION = 'execution-memory-distiller@2.1.0';
const PLANNING_DISTILLATION_VERSION = 'planning-memory-distiller@1.1.0';
const REVIEW_DISTILLATION_VERSION = 'review-memory-distiller@1.1.0';
```

- [ ] **Step 5: Update version strings in test assertions**

In `apps/code-agent/src/__tests__/domain/useCases/processExecutionMemoryBacklog.test.ts`, find and replace all occurrences of the old version strings:
- `'execution-memory-distiller@2.0.0'` -> `'execution-memory-distiller@2.1.0'`
- `'planning-memory-distiller@1.0.0'` -> `'planning-memory-distiller@1.1.0'`
- `'review-memory-distiller@1.0.0'` -> `'review-memory-distiller@1.1.0'`

- [ ] **Step 6: Run all tests to verify they pass**

```bash
cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/useCases/processExecutionMemoryBacklog.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: ALL PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/code-agent/src/domain/usecases/processExecutionMemoryBacklog.ts apps/code-agent/src/__tests__/domain/useCases/processExecutionMemoryBacklog.test.ts
git commit -m "feat(code-agent): improve componentHints guidance in distillation prompts

Adds explicit instructions to the distillation schema block about
using canonical service/module names (e.g. code-agent, orchestrator,
firestore) instead of generic terms. Includes format rules, good/bad
examples, and a recommended vocabulary list. Bumps distillation
versions to 2.1.0/1.1.0/1.1.0."
```

---

### Task 4: Run full workspace verification

**Files:** None (verification only)

- [ ] **Step 1: Build packages**

```bash
cd /repo && pnpm build
```

- [ ] **Step 2: Run workspace verification for code-agent**

```bash
cd /repo && pnpm run verify:workspace:tracked -- code-agent
```

Expected: ALL PASS — lint, type-check, tests, coverage all green.

- [ ] **Step 3: Run full CI**

```bash
cd /repo && pnpm run ci:tracked
```

Expected: ALL PASS.

- [ ] **Step 4: Commit any remaining fixes if needed**

If any lint/type/coverage issues surface, fix them and commit before proceeding.

---

## Weight Change Impact Analysis

Below is a verification of how the new weights affect existing test scenarios:

### Test: "matched context" (mem-1, vectorScore=0.95, components=['route','logging','verification'])

| Signal                          | Old Weight  | Old Score        | New Weight  | New Score         |
| ------------------------------- | ----------- | ---------------- | ----------- | ----------------- |
| vectorScore (0.95)              | 0.65        | 0.6175           | 0.50        | 0.475             |
| componentOverlap (3/4=0.75)     | 0.15        | 0.1125           | 0.20        | 0.15              |
| labelOverlap (2/2=1.0)          | 0.10        | 0.10             | 0.15        | 0.15              |
| effectiveness ((2+1)/(3+2)=0.6) | 0.10        | 0.06             | 0.15        | 0.09              |
| **Total**                       |             | **0.89**         |             | **0.865**         |
| **Passes threshold?**           |             | 0.89 >= 0.68 YES |             | 0.865 >= 0.55 YES |

### Test: "no_match" (mem-low, vectorScore=0.51, components=['unrelated'])

| Signal                   | Old Weight  | Old Score         | New Weight  | New Score        |
| ------------------------ | ----------- | ----------------- | ----------- | ---------------- |
| vectorScore (0.51)       | 0.65        | 0.3315            | 0.50        | 0.255            |
| componentOverlap (0/8=0) | 0.15        | 0                 | 0.20        | 0                |
| labelOverlap (0/1=0)     | 0.10        | 0                 | 0.15        | 0                |
| effectiveness (0.6)      | 0.10        | 0.06              | 0.15        | 0.09             |
| **Total**                |             | **0.3915**        |             | **0.345**        |
| **Passes threshold?**    |             | 0.3915 >= 0.68 NO |             | 0.345 >= 0.55 NO |

All existing test expectations remain valid with the new weights.

---

## Summary of Constants Changed

| Constant                        | Old Value   | New Value   | Rationale                                                   |
| ------------------------------- | ----------- | ----------- | ----------------------------------------------------------- |
| `MIN_RERANK_SCORE`              | 0.68        | 0.55        | Allows near-matches through; matches new score distribution |
| vectorScore weight              | 0.65        | 0.50        | Reduces over-reliance on raw embedding similarity           |
| componentOverlap weight         | 0.15        | 0.20        | Increases influence of topical matching                     |
| labelOverlap weight             | 0.10        | 0.15        | Increases influence of label matching                       |
| effectiveness weight            | 0.10        | 0.15        | Increases influence of historical success rate              |
| `RETRIEVAL_VERSION`             | 1.0.0       | 2.0.0       | Major: scoring behavior change                              |
| `DISTILLATION_VERSION`          | 2.0.0       | 2.1.0       | Minor: improved prompt guidance                             |
| `PLANNING_DISTILLATION_VERSION` | 1.0.0       | 1.1.0       | Minor: version alignment                                    |
| `REVIEW_DISTILLATION_VERSION`   | 1.0.0       | 1.1.0       | Minor: version alignment                                    |
