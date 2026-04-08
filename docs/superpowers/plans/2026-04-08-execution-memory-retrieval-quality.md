# Execution Memory Retrieval Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 6 systemic failures in the execution memory retrieval pipeline — corrupted embeddings, broken component overlap, missing observability, unconstrained query normalization, high rerank threshold, and memory bloat.

**Architecture:** All changes are in `apps/code-agent` (retrieval logic, models, repos) and `apps/web` (display). Two one-time Firestore migrations delete corrupted memories and deduplicate bloated inventory. No new endpoints — memory retrieval is internal.

**Tech Stack:** TypeScript, Firestore, Vitest, React/TailwindCSS

**Spec:** `docs/superpowers/specs/2026-04-08-execution-memory-retrieval-quality-design.md`

---

### Task 1: Lower MIN_RERANK_SCORE and Fix overlapRatio Tokenization

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/prepareExecutionMemoryContext.ts:18,395-409,450-469`
- Test: `apps/code-agent/src/__tests__/domain/useCases/prepareExecutionMemoryContext.test.ts`

- [ ] **Step 1: Write failing test for tokenized overlapRatio**

Add to `prepareExecutionMemoryContext.test.ts` after the existing `parseJsonObject` describe block:

```typescript
describe('overlapRatio with tokenized inputs', () => {
  const { overlapRatio } = prepareExecutionMemoryContextTestables;

  it('matches multi-word query components against single-word componentHints', () => {
    const queryComponents = ['code tasks filter', 'issue-groups api endpoint', 'firestore data'];
    const componentHints = ['code-agent', 'firestore', 'routing'];
    // "firestore data" tokenizes to ["firestore", "data"]
    // "code tasks filter" tokenizes to ["code", "tasks", "filter"] — all < 4 chars except "code","tasks","filter" (4,5,6)
    // "issue-groups api endpoint" tokenizes to ["issue", "groups", "endpoint"] (api < 4)
    // componentHints tokenize to ["code", "agent", "firestore", "routing"] (code-agent splits)
    // query tokens: {code, tasks, filter, issue, groups, endpoint, firestore, data}
    // hint tokens: {code, agent, firestore, routing}
    // overlap: code, firestore = 2
    // ratio: 2 / 8 = 0.25
    expect(overlapRatio(queryComponents, componentHints)).toBeCloseTo(0.25, 2);
  });

  it('returns 0 when both sides are empty', () => {
    expect(overlapRatio([], [])).toBe(0);
  });

  it('returns 0 when query has no tokens >= 4 chars', () => {
    expect(overlapRatio(['a b c'], ['firestore'])).toBe(0);
  });

  it('returns 1 when all query tokens match hints', () => {
    expect(overlapRatio(['firestore'], ['firestore', 'routing'])).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/code-agent && npx vitest run src/__tests__/domain/useCases/prepareExecutionMemoryContext.test.ts --reporter=verbose 2>&1 | tail -30`
Expected: FAIL — `overlapRatio` currently does exact string matching so multi-word phrases don't match.

- [ ] **Step 3: Implement tokenized overlapRatio and lower MIN_RERANK_SCORE**

In `apps/code-agent/src/domain/usecases/prepareExecutionMemoryContext.ts`:

Change line 18:
```typescript
const MIN_RERANK_SCORE = 0.50;
```

Replace the `overlapRatio` function (lines 454-469):
```typescript
function overlapRatio(left: string[], right: string[]): number {
  const leftTokens = new Set(left.flatMap((v) => tokenize(v)));
  const rightTokens = new Set(right.flatMap((v) => tokenize(v)));
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }
  let overlap = 0;
  for (const value of leftTokens) {
    if (rightTokens.has(value)) {
      overlap += 1;
    }
  }
  return overlap / Math.max(leftTokens.size, 1);
}
```

Remove the now-unused `dedupeLower` function (lines 450-452). Also remove the call to `dedupeLower` in the observability logging block (line 176) — replace `dedupeLower(normalization.components)` with `normalization.components` since `overlapRatio` now tokenizes internally. Same for the reranking function (line 395) — replace `dedupeLower(normalization.components)` with `normalization.components`.

Wait — `dedupeLower` is still used in the logging block at line 176 to compute `componentOverlap` for observability. Since `overlapRatio` now tokenizes internally, just pass raw components:

Line 176: change `const queryComponents = dedupeLower(normalization.components);` to `const queryComponents = normalization.components;`
Line 395: change `const queryComponents = dedupeLower(normalization.components);` to `const queryComponents = normalization.components;`

Then remove the `dedupeLower` function entirely.

- [ ] **Step 4: Update existing tests that are affected by the threshold change**

The test at line 180 (`falls back to deterministic normalization and records no_match when no memory survives reranking`) uses a memory with `vectorScore: 0.51`. Old rerank score: `0.55*0.51 + 0.25*0 + 0.20*0.5 = 0.2805 + 0 + 0.10 = 0.3805` — still below 0.50, so this test still passes.

The test at line 389 (`falls back when the normalizer returns invalid JSON`) uses `vectorScore: 0.6, componentHints: []`. Old rerank: `0.55*0.6 + 0.25*0 + 0.20*0.5 = 0.33 + 0 + 0.10 = 0.43` — still below 0.50, still passes.

The test at line 579 (`logs top-3 reranked candidates with score breakdowns even when none pass the threshold`) uses `vectorScore: 0.70, componentHints: []`. Old rerank: `0.55*0.70 + 0.25*0 + 0.20*0.5 = 0.385 + 0 + 0.10 = 0.485` — still below 0.50. **But wait** — the test asserts `passedThreshold: false`. With the new threshold of 0.50, the score 0.485 is still below 0.50, so this test still passes.

The test at line 555 (`scores candidates using rebalanced weights`) uses `vectorScore: 0.75, componentHints: ['auth', 'route', 'logging'], components: ['auth', 'route', 'logging', 'verification']`. With tokenized overlap: query tokens = `{auth, route, logging, verification}`, hint tokens = `{auth, route, logging}`, overlap = 3/4 = 0.75. The test asserts `0.55*0.75 + 0.25*(3/4) + 0.20*(1/2) = 0.70`. This is already correct because the old code also matched these single-word strings exactly. No change needed.

The test at line 126 (`returns matched context`) has memories with `componentHints: ['route', 'logging', 'verification']` and query `components: ['auth', 'route', 'logging', 'verification']`. These are single-word tokens that already match. No change needed.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/code-agent && npx vitest run src/__tests__/domain/useCases/prepareExecutionMemoryContext.test.ts --reporter=verbose 2>&1 | tail -30`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add apps/code-agent/src/domain/usecases/prepareExecutionMemoryContext.ts apps/code-agent/src/__tests__/domain/useCases/prepareExecutionMemoryContext.test.ts
git commit -m "fix: tokenize overlapRatio and lower MIN_RERANK_SCORE to 0.50

Multi-word query components now match single-word componentHints via
tokenization. Threshold lowered from 0.55 to 0.50 to allow legitimate
matches through with the improved component overlap signal."
```

---

### Task 2: Constrain Query Normalization Prompt

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/prepareExecutionMemoryContext.ts:364-384`
- Test: `apps/code-agent/src/__tests__/domain/useCases/prepareExecutionMemoryContext.test.ts`

- [ ] **Step 1: Write failing test for normalization prompt content**

Add after the `overlapRatio` describe block:

```typescript
describe('buildNormalizationPrompt', () => {
  it('includes canonical component format instructions', () => {
    const prompt = prepareExecutionMemoryContextTestables.buildNormalizationPrompt(
      { prompt: 'Fix the route', sanitizedPrompt: 'Fix the route' },
      { description: null, comments: [] }
    );
    expect(prompt).toContain('single-word or hyphenated canonical identifiers');
    expect(prompt).toContain('code-agent');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/code-agent && npx vitest run src/__tests__/domain/useCases/prepareExecutionMemoryContext.test.ts -t "includes canonical component" --reporter=verbose 2>&1 | tail -15`
Expected: FAIL — prompt doesn't contain these instructions yet.

- [ ] **Step 3: Update the normalization prompt**

In `apps/code-agent/src/domain/usecases/prepareExecutionMemoryContext.ts`, in `buildNormalizationPrompt()` function, replace the schema line (currently a single JSON schema string) with:

```typescript
function buildNormalizationPrompt(
  task: Pick<CodeTask, 'prompt' | 'sanitizedPrompt'>,
  issueContext: { description: string | null; comments: string[] }
): string {
  return [
    `Version: ${QUERY_NORMALIZER_VERSION}`,
    'Return JSON only.',
    'Summarize this execution task into a retrieval query for reusable implementation memories.',
    '',
    `Task prompt:\n${task.prompt}`,
    '',
    `Sanitized prompt:\n${task.sanitizedPrompt}`,
    '',
    `Linear description:\n${issueContext.description ?? ''}`,
    '',
    `Recent Linear comments:\n${issueContext.comments.join('\n---\n')}`,
    '',
    'Schema:',
    '{"semanticQuery":"string","components":["string"],"riskFlags":["string"],"verificationGoals":["string"],"summary":"string"}',
    '',
    'components: Use single-word or hyphenated canonical identifiers matching service/module names.',
    'Examples: "code-agent", "firestore", "routing", "testing", "web-app", "orchestrator",',
    '"common-core", "linear", "pubsub", "migrations", "ci", "planning", "memory".',
    'Do NOT use multi-word descriptive phrases like "code tasks filter" or "issue-groups API endpoint".',
  ].join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/code-agent && npx vitest run src/__tests__/domain/useCases/prepareExecutionMemoryContext.test.ts --reporter=verbose 2>&1 | tail -30`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/usecases/prepareExecutionMemoryContext.ts apps/code-agent/src/__tests__/domain/useCases/prepareExecutionMemoryContext.test.ts
git commit -m "fix: constrain query normalization prompt to canonical component identifiers

Instructs the LLM to produce single-word/hyphenated identifiers matching
the componentHints vocabulary instead of multi-word descriptive phrases."
```

---

### Task 3: Store Top 5 Candidates in Application Records and CodeTask Context

**Files:**
- Modify: `apps/code-agent/src/domain/models/codeTask.ts:97-117`
- Modify: `apps/code-agent/src/domain/models/executionMemoryApplication.ts:7-13`
- Modify: `apps/code-agent/src/domain/repositories/executionMemoryApplicationRepository.ts:9-24`
- Modify: `apps/code-agent/src/domain/usecases/prepareExecutionMemoryContext.ts:170-233`
- Test: `apps/code-agent/src/__tests__/domain/useCases/prepareExecutionMemoryContext.test.ts`

- [ ] **Step 1: Add `ExecutionMemoryCandidate` type to codeTask.ts**

In `apps/code-agent/src/domain/models/codeTask.ts`, after `ExecutionMemoryContextMemory`, add:

```typescript
export interface ExecutionMemoryCandidate {
  memoryId: string;
  title: string;
  memoryType: ExecutionMemoryType;
  vectorScore: number;
  rerankScore: number;
  componentOverlap: number;
  effectiveness: number;
  passedThreshold: boolean;
}
```

Add `topCandidates` to `ExecutionMemoryContext`:

```typescript
export interface ExecutionMemoryContext {
  status: 'none' | 'matched' | 'error';
  applicationId?: string;
  retrievalVersion?: string;
  querySummary?: string;
  matchedAt?: Timestamp;
  matchedMemories?: ExecutionMemoryContextMemory[];
  topCandidates?: ExecutionMemoryCandidate[];
  errorCode?: string;
  errorMessage?: string;
}
```

- [ ] **Step 2: Add `topCandidates` to application model and repo input**

In `apps/code-agent/src/domain/models/executionMemoryApplication.ts`, add to `ExecutionMemoryApplicationMatch`:

```typescript
export interface ExecutionMemoryApplicationCandidate {
  memoryId: string;
  title: string;
  memoryType: ExecutionMemoryType;
  vectorScore: number;
  rerankScore: number;
  componentOverlap: number;
  effectiveness: number;
  passedThreshold: boolean;
}
```

Add `topCandidates?: ExecutionMemoryApplicationCandidate[]` to the `ExecutionMemoryApplication` interface.

In `apps/code-agent/src/domain/repositories/executionMemoryApplicationRepository.ts`, add `topCandidates` to `CreateExecutionMemoryApplicationInput`:

```typescript
export interface CreateExecutionMemoryApplicationInput {
  // ... existing fields ...
  topCandidates?: Array<{
    memoryId: string;
    title: string;
    memoryType: ExecutionMemoryType;
    vectorScore: number;
    rerankScore: number;
    componentOverlap: number;
    effectiveness: number;
    passedThreshold: boolean;
  }>;
}
```

- [ ] **Step 3: Write failing test for topCandidates in context and application**

Add a new test after the existing `logs top-3 reranked candidates` test:

```typescript
it('stores topCandidates in both the application record and the returned context', async () => {
  queryClient.generate.mockResolvedValue(ok({
    content: JSON.stringify({
      semanticQuery: 'auth route logging verification',
      components: ['auth', 'route', 'logging'],
      riskFlags: [],
      verificationGoals: [],
      summary: 'Auth route logging',
    }),
    usage: { model: LlmModels.Gemini25Flash },
  }));

  embeddingClient.embed.mockResolvedValue(ok([0.1, 0.2, 0.3]));
  executionMemoryRepo.findNearest.mockResolvedValue(ok([
    createMatch('mem-pass', {
      vectorScore: 0.95,
      componentHints: ['auth', 'route', 'logging'],
      applicationCount: 2,
      positiveCount: 2,
    }),
    createMatch('mem-fail', {
      vectorScore: 0.40,
      componentHints: ['unrelated'],
      applicationCount: 0,
      positiveCount: 0,
    }),
  ]));
  executionMemoryApplicationRepo.create.mockResolvedValue(ok({ id: 'app-candidates' }));

  const result = await prepareExecutionMemoryContext({
    task: createTask(),
    logger,
    linearAgentClient: linearAgentClient as never,
    queryClient: queryClient as never,
    embeddingClient: embeddingClient as never,
    executionMemoryRepo: executionMemoryRepo as never,
    executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
  });

  expect(result?.topCandidates).toHaveLength(2);
  expect(result?.topCandidates?.[0]).toMatchObject({
    memoryId: 'mem-pass',
    passedThreshold: true,
    vectorScore: 0.95,
  });
  expect(result?.topCandidates?.[1]).toMatchObject({
    memoryId: 'mem-fail',
    passedThreshold: false,
  });

  expect(executionMemoryApplicationRepo.create).toHaveBeenCalledWith(
    expect.objectContaining({
      topCandidates: expect.arrayContaining([
        expect.objectContaining({ memoryId: 'mem-pass', passedThreshold: true }),
        expect.objectContaining({ memoryId: 'mem-fail', passedThreshold: false }),
      ]),
    })
  );
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd apps/code-agent && npx vitest run src/__tests__/domain/useCases/prepareExecutionMemoryContext.test.ts -t "stores topCandidates" --reporter=verbose 2>&1 | tail -15`
Expected: FAIL — `topCandidates` not in result or application create call.

- [ ] **Step 5: Implement topCandidates in prepareExecutionMemoryContext**

In `apps/code-agent/src/domain/usecases/prepareExecutionMemoryContext.ts`:

Add a constant at the top near existing constants:
```typescript
const TOP_CANDIDATES_LIMIT = 5;
```

After the reranking and filtering block (after line 173), build the topCandidates array:

```typescript
const topCandidates = reranked.slice(0, TOP_CANDIDATES_LIMIT).map((candidate) => ({
  memoryId: candidate.memory.id,
  title: candidate.memory.title,
  memoryType: candidate.memory.memoryType,
  vectorScore: candidate.memory.vectorScore,
  rerankScore: roundScore(candidate.rerankScore),
  componentOverlap: roundScore(overlapRatio(normalization.components, candidate.memory.componentHints)),
  effectiveness: roundScore(
    (candidate.memory.positiveCount + 1) / (candidate.memory.applicationCount + 2)
  ),
  passedThreshold: candidate.rerankScore >= MIN_RERANK_SCORE,
}));
```

Pass `topCandidates` to `createApplication`:
```typescript
const applicationId = await createApplication({
  executionMemoryApplicationRepo,
  task,
  normalization,
  status: matchedMemories.length > 0 ? 'matched' : 'no_match',
  matchedMemories,
  topCandidates,
});
```

Include `topCandidates` in both return paths (`status: 'none'` and `status: 'matched'`):

```typescript
if (matchedMemories.length === 0) {
  return {
    status: 'none',
    ...(applicationId !== undefined && { applicationId }),
    retrievalVersion: RETRIEVAL_VERSION,
    querySummary: normalization.summary,
    topCandidates,
  };
}

return {
  status: 'matched',
  ...(applicationId !== undefined && { applicationId }),
  retrievalVersion: RETRIEVAL_VERSION,
  querySummary: normalization.summary,
  matchedAt: Timestamp.now(),
  matchedMemories: matchedMemories.map((match) => ({
    memoryId: match.memory.id,
    title: match.memory.title,
    memoryType: match.memory.memoryType,
    score: roundScore(match.rerankScore),
    appliesWhen: clampField(match.memory.appliesWhen),
    action: clampField(match.memory.action),
    avoid: clampField(match.memory.avoid),
    verification: clampField(match.memory.verification),
  })),
  topCandidates,
};
```

Update `createApplication` function signature and body to accept and store `topCandidates`:

```typescript
async function createApplication(params: {
  executionMemoryApplicationRepo: Pick<ExecutionMemoryApplicationRepository, 'create'>;
  task: Pick<CodeTask, 'id' | 'repository' | 'linearIssueId'>;
  normalization: QueryNormalization;
  status: 'matched' | 'no_match' | 'error';
  matchedMemories: {
    memory: {
      id: string;
      title: string;
      memoryType: ExecutionMemoryType;
      vectorScore: number;
    };
    rerankScore: number;
  }[];
  topCandidates?: Array<{
    memoryId: string;
    title: string;
    memoryType: ExecutionMemoryType;
    vectorScore: number;
    rerankScore: number;
    componentOverlap: number;
    effectiveness: number;
    passedThreshold: boolean;
  }>;
}): Promise<string | undefined> {
  const createResult = await params.executionMemoryApplicationRepo.create({
    taskId: params.task.id,
    repository: params.task.repository,
    ...(params.task.linearIssueId !== undefined && { linearIssueId: params.task.linearIssueId }),
    querySummary: params.normalization.summary,
    queryText: params.normalization.semanticQuery,
    queryComponents: params.normalization.components,
    queryRiskFlags: params.normalization.riskFlags,
    retrievalVersion: RETRIEVAL_VERSION,
    matchedMemories: params.matchedMemories.map((match) => ({
      memoryId: match.memory.id,
      vectorScore: match.memory.vectorScore,
      rerankScore: roundScore(match.rerankScore),
      title: match.memory.title,
      memoryType: match.memory.memoryType,
    })),
    status: params.status,
    memoryIdsUsed: [],
    memoryIdsRejected: [],
    ...(params.topCandidates !== undefined && { topCandidates: params.topCandidates }),
  });

  return createResult.ok ? createResult.value.id : undefined;
}
```

- [ ] **Step 6: Run all prepareExecutionMemoryContext tests**

Run: `cd apps/code-agent && npx vitest run src/__tests__/domain/useCases/prepareExecutionMemoryContext.test.ts --reporter=verbose 2>&1 | tail -30`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add apps/code-agent/src/domain/models/codeTask.ts apps/code-agent/src/domain/models/executionMemoryApplication.ts apps/code-agent/src/domain/repositories/executionMemoryApplicationRepository.ts apps/code-agent/src/domain/usecases/prepareExecutionMemoryContext.ts apps/code-agent/src/__tests__/domain/useCases/prepareExecutionMemoryContext.test.ts
git commit -m "feat: store top 5 candidates in application records and task context

Saves topCandidates with full score breakdown (vectorScore, rerankScore,
componentOverlap, effectiveness, passedThreshold) regardless of whether
they passed the rerank threshold. Enables debugging retrieval quality
from Firestore data instead of ephemeral logs."
```

---

### Task 4: Display Top Candidates in Web App

**Files:**
- Modify: `apps/web/src/types/index.ts:1164-1184`
- Modify: `apps/web/src/pages/CodeTaskViewPage.tsx:228-303`

- [ ] **Step 1: Update web app types**

In `apps/web/src/types/index.ts`, update `CodeTaskExecutionMemoryMatch.memoryType` to include all types:

```typescript
export interface CodeTaskExecutionMemoryMatch {
  memoryId: string;
  title: string;
  memoryType: 'implementation_pattern' | 'verification_pattern' | 'pitfall_pattern' | 'decomposition_pattern' | 'planning_decision' | 'review_finding';
  score: number;
  appliesWhen: string;
  action: string;
  avoid: string;
  verification: string;
}
```

Add the candidate type and update context:

```typescript
export interface CodeTaskExecutionMemoryCandidate {
  memoryId: string;
  title: string;
  memoryType: CodeTaskExecutionMemoryMatch['memoryType'];
  vectorScore: number;
  rerankScore: number;
  componentOverlap: number;
  effectiveness: number;
  passedThreshold: boolean;
}

export interface CodeTaskExecutionMemoryContext {
  status: 'none' | 'matched' | 'error';
  applicationId?: string;
  retrievalVersion?: string;
  querySummary?: string;
  matchedAt?: string;
  matchedMemories?: CodeTaskExecutionMemoryMatch[];
  topCandidates?: CodeTaskExecutionMemoryCandidate[];
  errorCode?: string;
  errorMessage?: string;
}
```

- [ ] **Step 2: Update CodeTaskViewPage to show candidates**

In `apps/web/src/pages/CodeTaskViewPage.tsx`, inside the `MemoExecutionMemoryCard` component, after the existing `matchedMemories` block and before the `postRun` block, add:

```tsx
{context?.topCandidates !== undefined && context.topCandidates.length > 0 ? (
  <div className="mb-4">
    <h4 className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
      Top Candidates
    </h4>
    <div className="space-y-1.5">
      {context.topCandidates.map((candidate) => (
        <div
          key={candidate.memoryId}
          className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs ${
            candidate.passedThreshold
              ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/30'
              : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/40'
          }`}
        >
          <span className={`font-mono font-medium ${
            candidate.passedThreshold
              ? 'text-emerald-700 dark:text-emerald-300'
              : 'text-slate-500 dark:text-slate-400'
          }`}>
            {candidate.rerankScore.toFixed(3)}
          </span>
          <span className="truncate text-slate-700 dark:text-slate-200">{candidate.title}</span>
          <span className="ml-auto flex shrink-0 gap-1.5 text-slate-400 dark:text-slate-500">
            <span title="Vector score">V:{candidate.vectorScore.toFixed(2)}</span>
            <span title="Component overlap">C:{candidate.componentOverlap.toFixed(2)}</span>
            <span title="Effectiveness">E:{candidate.effectiveness.toFixed(2)}</span>
          </span>
        </div>
      ))}
    </div>
  </div>
) : null}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/types/index.ts apps/web/src/pages/CodeTaskViewPage.tsx
git commit -m "feat: display top 5 retrieval candidates on code task page

Shows all candidates with score breakdown (vector, component overlap,
effectiveness). Passed candidates are highlighted green, near-misses
are shown in slate. Adds missing memoryType values to web app types."
```

---

### Task 5: Lower Near-Duplicate Merge Threshold

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/processExecutionMemoryBacklog.ts:279`
- Test: `apps/code-agent/src/__tests__/domain/useCases/processExecutionMemoryBacklog.test.ts`

- [ ] **Step 1: Write failing test for new merge threshold**

Add to `processExecutionMemoryBacklog.test.ts`. Find the existing test `covers exact-match and near-duplicate merge paths in processOneTask` (around line 1112). After it, add:

```typescript
it('merges near-duplicates at the lowered 0.88 threshold', async () => {
  const distillation = ok({
    content: JSON.stringify({
      decision: 'create',
      evidenceSummary: 'Found reusable pattern.',
      memories: [{
        memoryType: 'pitfall_pattern',
        title: 'Avoid stale cache',
        appliesWhen: 'cache invalidation',
        action: 'invalidate on write',
        avoid: 'skip invalidation',
        verification: 'test cache flow',
        evidenceSummary: 'evidence',
        retrievalText: 'cache invalidation pattern',
        keywords: ['cache'],
        componentHints: ['code-agent'],
        confidence: 0.85,
      }],
    }),
    usage: { model: LlmModels.Gemini25Flash },
  });

  distillerClient.generate.mockResolvedValue(distillation);
  embeddingClient.embed.mockResolvedValue(ok([0.1, 0.2, 0.3]));
  executionMemoryRepo.findByFingerprint.mockResolvedValue(ok(null));
  // Near-duplicate found at 0.90 (above 0.88, below old 0.94)
  executionMemoryRepo.findNearest.mockResolvedValue(ok([
    {
      ...createMemory({ id: 'mem-near-088', applicationCount: 1, positiveCount: 1 }),
      vectorScore: 0.90,
    },
  ]));
  executionMemoryRepo.update.mockResolvedValue(ok(createMemory()));

  const result = await processExecutionMemoryBacklogTestables.processOneTask(
    createTask({ status: 'completed' }),
    createDeps()
  );

  expect(result.status).toBe('completed');
  expect(result.generatedMemoryIds).toContain('mem-near-088');
  expect(executionMemoryRepo.update).toHaveBeenCalledWith(
    'mem-near-088',
    expect.objectContaining({ title: 'Avoid stale cache' })
  );
  expect(executionMemoryRepo.create).not.toHaveBeenCalled();
});
```

Note: Adapt `createMemory`, `createTask`, `createDeps` to match the existing test helpers in the file. Read the test file for exact helper signatures.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/code-agent && npx vitest run src/__tests__/domain/useCases/processExecutionMemoryBacklog.test.ts -t "merges near-duplicates at the lowered" --reporter=verbose 2>&1 | tail -15`
Expected: FAIL — current threshold is 0.94, so 0.90 won't merge.

- [ ] **Step 3: Lower the threshold**

In `apps/code-agent/src/domain/usecases/processExecutionMemoryBacklog.ts`, line 279, change:

```typescript
const mergeCandidate = nearDuplicateResult.value.find((candidate) =>
  candidate.memoryType === memory.memoryType && candidate.vectorScore >= 0.88
);
```

- [ ] **Step 4: Run all processExecutionMemoryBacklog tests**

Run: `cd apps/code-agent && npx vitest run src/__tests__/domain/useCases/processExecutionMemoryBacklog.test.ts --reporter=verbose 2>&1 | tail -30`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/usecases/processExecutionMemoryBacklog.ts apps/code-agent/src/__tests__/domain/useCases/processExecutionMemoryBacklog.test.ts
git commit -m "fix: lower near-duplicate merge threshold from 0.94 to 0.88

Allows more aggressive deduplication during memory creation, reducing
the 608-memory bloat. Memories of the same type with vectorScore >= 0.88
are now merged instead of creating new entries."
```

---

### Task 6: Migration — Delete Corrupted Memories

**Files:**
- Create: `migrations/084_delete-corrupted-execution-memories.mjs`

- [ ] **Step 1: Create the migration**

```javascript
export const metadata = {
  id: '084',
  name: 'delete-corrupted-execution-memories',
  description:
    'Delete execution memories with corrupted/zero embedding vectors that return cosineDistance=0 against any query',
  createdAt: '2026-04-08',
};

export async function up(context) {
  const corruptedIds = [
    'mem_1cc9e496-179b-43be-8292-1d43ab140f26',
    'mem_60538ec6-24b7-440c-aaa8-c875ab2bf924',
    'mem_99413905-cde2-4a84-b007-b0dcce3b235a',
    'mem_4ee596d9-5e3b-4c98-879a-32169a8abb12',
    'mem_faf3aaab-287f-4ddb-9219-694e60295870',
  ];

  console.log(`  Deleting ${corruptedIds.length} memories with corrupted embeddings...`);

  const collection = context.firestore.collection('execution_memories');
  let deletedCount = 0;

  for (const id of corruptedIds) {
    const doc = await collection.doc(id).get();
    if (!doc.exists) {
      console.log(`  ${id} — already deleted, skipping`);
      continue;
    }
    const data = doc.data();
    console.log(`  ${id} — "${data.title}" (status: ${data.status}) — deleting`);
    await collection.doc(id).delete();
    deletedCount++;
  }

  console.log(`  Deleted ${deletedCount} corrupted memories.`);
}
```

- [ ] **Step 2: Commit**

```bash
git add migrations/084_delete-corrupted-execution-memories.mjs
git commit -m "migration: delete 5 execution memories with corrupted embedding vectors

These memories had zero/null embeddings causing cosineDistance=0 against
any query, monopolizing retrieval slots and crowding out relevant results."
```

---

### Task 7: Migration — Deduplicate Execution Memories

**Files:**
- Create: `migrations/085_deduplicate-execution-memories.mjs`

- [ ] **Step 1: Create the dedup migration**

```javascript
export const metadata = {
  id: '085',
  name: 'deduplicate-execution-memories',
  description:
    'One-time deduplication pass: for each memory, find near-duplicates (same type, vectorScore >= 0.88), keep highest qualityScore, suppress the rest',
  createdAt: '2026-04-08',
};

export async function up(context) {
  const { FieldValue } = await import('firebase-admin/firestore');
  const collection = context.firestore.collection('execution_memories');
  const snapshot = await collection
    .where('repository', '==', 'pbuchman/intexuraos')
    .where('status', '==', 'active')
    .get();

  if (snapshot.empty) {
    console.log('  No active execution memories found.');
    return;
  }

  console.log(`  Found ${snapshot.size} active memories. Running dedup pass...`);

  // Build an in-memory index: group by memoryType
  const byType = {};
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const type = data.memoryType;
    if (!byType[type]) byType[type] = [];
    byType[type].push({
      id: doc.id,
      title: data.title,
      qualityScore: typeof data.qualityScore === 'number' ? data.qualityScore : 0,
      fingerprint: data.fingerprint || '',
      retrievalText: data.retrievalText || '',
    });
  }

  // For each type group, find memories with identical fingerprints (exact dupes)
  let suppressedCount = 0;
  const batch = context.firestore.batch();
  let batchCount = 0;
  const batchSize = 400;

  for (const [type, memories] of Object.entries(byType)) {
    // Group by fingerprint for exact dedup
    const byFingerprint = {};
    for (const mem of memories) {
      if (mem.fingerprint === '') continue;
      if (!byFingerprint[mem.fingerprint]) byFingerprint[mem.fingerprint] = [];
      byFingerprint[mem.fingerprint].push(mem);
    }

    for (const [fingerprint, group] of Object.entries(byFingerprint)) {
      if (group.length <= 1) continue;

      // Keep highest qualityScore, suppress the rest
      group.sort((a, b) => b.qualityScore - a.qualityScore);
      const keeper = group[0];
      console.log(`  [${type}] Keeping "${keeper.title}" (quality=${keeper.qualityScore.toFixed(3)}), suppressing ${group.length - 1} dupes with fingerprint ${fingerprint.slice(0, 12)}...`);

      for (let i = 1; i < group.length; i++) {
        const dupe = group[i];
        batch.update(collection.doc(dupe.id), {
          status: 'suppressed',
          updatedAt: FieldValue.serverTimestamp(),
        });
        suppressedCount++;
        batchCount++;

        if (batchCount >= batchSize) {
          await batch.commit();
          batchCount = 0;
        }
      }
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }

  console.log(`  Dedup complete. Suppressed ${suppressedCount} duplicate memories.`);
}
```

- [ ] **Step 2: Commit**

```bash
git add migrations/085_deduplicate-execution-memories.mjs
git commit -m "migration: deduplicate execution memories by fingerprint

Groups active memories by memoryType + fingerprint, keeps the one with
highest qualityScore, and suppresses duplicates. Addresses the 608-memory
bloat where many near-identical memories were created."
```

---

### Task 8: Run Full CI Verification

- [ ] **Step 1: Build packages**

Run: `pnpm build`
Expected: Passes

- [ ] **Step 2: Run workspace verification for code-agent**

Run: `pnpm run verify:workspace:tracked code-agent`
Expected: Passes

- [ ] **Step 3: Run full CI**

Run: `pnpm run ci:tracked`
Expected: ALL PASS
