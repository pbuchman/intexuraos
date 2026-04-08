# Execution Memory UI Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show top 5 execution memory candidates on the code task UI with Injected/Candidate labels, summary stats, and persist `totalSearchResults` for later analysis.

**Architecture:** Add `totalSearchResults` to `ExecutionMemoryContext` on the backend (populated from `reranked.length`). Redesign the frontend `MemoExecutionMemoryCard` to show a unified candidate list (up to 5) with injection badges and a summary stats banner. Update `TaskHeader` chip to reflect injected vs shown counts.

**Tech Stack:** TypeScript, React, Tailwind CSS, Firestore (existing `ExecutionMemoryContext` on code task document)

---

### File Map

| Action   | File                                                                                  | Responsibility                                                        |
| -------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Modify   | `apps/code-agent/src/domain/models/codeTask.ts:109-119`                               | Add `totalSearchResults` to `ExecutionMemoryContext`                  |
| Modify   | `apps/code-agent/src/domain/usecases/prepareExecutionMemoryContext.ts:172-238`        | Populate `totalSearchResults` from `reranked.length`                  |
| Modify   | `apps/web/src/types/index.ts:1186-1196`                                               | Add `totalSearchResults` to `CodeTaskExecutionMemoryContext`          |
| Modify   | `apps/web/src/pages/CodeTaskViewPage.tsx:228-338`                                     | Redesign `MemoExecutionMemoryCard` with unified list and stats banner |
| Modify   | `apps/web/src/components/code-tasks/TaskHeader.tsx:40-46`                             | Update chip text to show injected/shown counts                        |
| Modify   | `apps/web/src/__tests__/CodeTaskViewPage.executionMemory.test.tsx`                    | Update tests for new UI structure                                     |
| Modify   | `apps/web/src/components/code-tasks/__tests__/TaskHeader.executionMemory.test.tsx`    | Update tests for new chip text                                        |
| Modify   | `apps/code-agent/src/domain/usecases/__tests__/prepareExecutionMemoryContext.test.ts` | Add test for `totalSearchResults` population                          |

---

### Task 1: Add `totalSearchResults` to backend `ExecutionMemoryContext` type

**Files:**
- Modify: `apps/code-agent/src/domain/models/codeTask.ts:109-119`

- [ ] **Step 1: Add `totalSearchResults` field to `ExecutionMemoryContext` interface**

Open `apps/code-agent/src/domain/models/codeTask.ts` and add one field to the `ExecutionMemoryContext` interface:

```typescript
export interface ExecutionMemoryContext {
  status: 'none' | 'matched' | 'error';
  applicationId?: string;
  retrievalVersion?: string;
  querySummary?: string;
  matchedAt?: Timestamp;
  matchedMemories?: ExecutionMemoryContextMemory[];
  topCandidates?: ExecutionMemoryApplicationCandidate[];
  totalSearchResults?: number;
  errorCode?: string;
  errorMessage?: string;
}
```

The field is optional (`?`) because error paths and pre-existing documents won't have it.

- [ ] **Step 2: Commit**

```bash
git add apps/code-agent/src/domain/models/codeTask.ts
git commit -m "feat(code-agent): add totalSearchResults to ExecutionMemoryContext type"
```

---

### Task 2: Populate `totalSearchResults` in the retrieval use case

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/prepareExecutionMemoryContext.ts:172-238`
- Test: `apps/code-agent/src/domain/usecases/__tests__/prepareExecutionMemoryContext.test.ts`

- [ ] **Step 1: Write a failing test for `totalSearchResults` in the matched path**

In the existing test file for `prepareExecutionMemoryContext`, find the test that covers the "matched" path (status is `'matched'`). Add an assertion that the returned context includes `totalSearchResults` set to the count of candidates returned by vector search (i.e., `reranked.length`).

For example, if the fake `findNearest` returns 8 candidates, the test should assert:

```typescript
expect(result.totalSearchResults).toBe(8);
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm run verify:workspace:tracked -- code-agent
```

Expected: FAIL — `totalSearchResults` is `undefined`.

- [ ] **Step 3: Populate `totalSearchResults` in the return values**

In `prepareExecutionMemoryContext.ts`, after line 172 (`const reranked = rerankMemories(...)`) store the count:

```typescript
const reranked = rerankMemories(nearestResult.value, normalization);
const totalSearchResults = reranked.length;
```

Then add `totalSearchResults` to BOTH return paths (the `none` path at line ~211 and the `matched` path at line ~221):

**`none` path (~line 211):**
```typescript
if (matchedMemories.length === 0) {
  return {
    status: 'none',
    ...(applicationId !== undefined && { applicationId }),
    retrievalVersion: RETRIEVAL_VERSION,
    querySummary: normalization.summary,
    topCandidates,
    totalSearchResults,
  };
}
```

**`matched` path (~line 221):**
```typescript
return {
  status: 'matched',
  ...(applicationId !== undefined && { applicationId }),
  retrievalVersion: RETRIEVAL_VERSION,
  querySummary: normalization.summary,
  topCandidates,
  totalSearchResults,
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
};
```

Do NOT add `totalSearchResults` to the error paths — those don't reach vector search.

- [ ] **Step 4: Also add a test for the `none` path**

Write a test where `findNearest` returns candidates but none pass the threshold (`MIN_RERANK_SCORE = 0.50`). Assert `result.totalSearchResults` equals the number of candidates returned. Assert `result.status` is `'none'`.

- [ ] **Step 5: Run tests to verify all pass**

```bash
pnpm run verify:workspace:tracked -- code-agent
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/code-agent/src/domain/usecases/prepareExecutionMemoryContext.ts
git add apps/code-agent/src/domain/usecases/__tests__/prepareExecutionMemoryContext.test.ts
git commit -m "feat(code-agent): populate totalSearchResults from reranked candidate count"
```

---

### Task 3: Add `totalSearchResults` to frontend type

**Files:**
- Modify: `apps/web/src/types/index.ts:1186-1196`

- [ ] **Step 1: Add `totalSearchResults` to `CodeTaskExecutionMemoryContext`**

```typescript
export interface CodeTaskExecutionMemoryContext {
  status: 'none' | 'matched' | 'error';
  applicationId?: string;
  retrievalVersion?: string;
  querySummary?: string;
  matchedAt?: string;
  matchedMemories?: CodeTaskExecutionMemoryMatch[];
  topCandidates?: CodeTaskExecutionMemoryCandidate[];
  totalSearchResults?: number;
  errorCode?: string;
  errorMessage?: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/types/index.ts
git commit -m "feat(web): add totalSearchResults to CodeTaskExecutionMemoryContext type"
```

---

### Task 4: Redesign `MemoExecutionMemoryCard` with unified candidate list and stats banner

**Files:**
- Modify: `apps/web/src/pages/CodeTaskViewPage.tsx:228-338`
- Test: `apps/web/src/__tests__/CodeTaskViewPage.executionMemory.test.tsx`

This is the main UI change. The current card has two separate sections: matched memories (with full detail) and top candidates (lightweight list). The new design merges them into one unified list where each candidate gets an **Injected** or **Candidate** badge based on `passedThreshold`.

#### Design

1. **Summary stats banner** at the top of the card (below the title):
   - Format: `"{totalSearchResults} memories searched · {injectedCount} injected · {belowThresholdCount} below threshold"`
   - Example: `"20 memories searched · 2 injected · 3 below threshold"`
   - If `totalSearchResults` is undefined (old data), show: `"{topCandidates.length} candidates shown"`
   - Use a subtle background: `bg-slate-100 dark:bg-slate-800` rounded banner.

2. **Unified candidate list** (replaces both the matched memories and top candidates sections):
   - Iterate over `topCandidates` (up to 5 items). This is the single source of truth for display.
   - For each candidate:
     - If `passedThreshold === true`: show green **Injected** badge (`bg-emerald-100 text-emerald-700`)
     - If `passedThreshold === false`: show gray **Candidate** badge (`bg-slate-200 text-slate-600`)
   - All candidates show: title, memoryType, rerankScore, vectorScore, componentOverlap, effectiveness
   - **Injected** candidates additionally show the full memory detail (appliesWhen, action, avoid, verification) by looking up the matching entry in `matchedMemories` by `memoryId`.
   - **Candidate** (non-injected) items show the score breakdown only — no detail expansion.

3. **Post-run section** stays unchanged at the bottom.

- [ ] **Step 1: Write failing tests for the new summary stats banner**

In `apps/web/src/__tests__/CodeTaskViewPage.executionMemory.test.tsx`, update the test task fixture to include `totalSearchResults: 20` on the `executionMemoryContext`. Then add tests:

```typescript
it('renders summary stats banner with search results count', () => {
  render(<CodeTaskViewPage />, { wrapper: MemoryRouter });
  expect(screen.getByText(/20 memories searched/)).toBeInTheDocument();
  expect(screen.getByText(/2 injected/)).toBeInTheDocument();
});
```

Also add a test for the case where `totalSearchResults` is undefined (backward compatibility):

```typescript
it('renders fallback stats when totalSearchResults is undefined', () => {
  // Create task fixture without totalSearchResults
  // Should show "{topCandidates.length} candidates shown"
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm run verify:workspace:tracked -- web
```

Expected: FAIL — banner text not found.

- [ ] **Step 3: Write failing tests for Injected/Candidate badges**

```typescript
it('renders Injected badge for candidates above threshold', () => {
  render(<CodeTaskViewPage />, { wrapper: MemoryRouter });
  const badges = screen.getAllByText('Injected');
  // Should match the count of topCandidates with passedThreshold === true
  expect(badges).toHaveLength(2); // based on test fixture
});

it('renders Candidate badge for candidates below threshold', () => {
  render(<CodeTaskViewPage />, { wrapper: MemoryRouter });
  const badges = screen.getAllByText('Candidate');
  // Should match count of topCandidates with passedThreshold === false
  expect(badges).toHaveLength(3); // based on test fixture
});
```

- [ ] **Step 4: Run tests to verify they fail**

```bash
pnpm run verify:workspace:tracked -- web
```

Expected: FAIL — badges not found.

- [ ] **Step 5: Implement the new `MemoExecutionMemoryCard`**

Replace the current implementation in `CodeTaskViewPage.tsx` (lines 228-338). Here is the full replacement:

```tsx
const MemoExecutionMemoryCard = memo(function ExecutionMemoryCard({ task }: { task: CodeTask }): React.JSX.Element | null {
  const context = task.executionMemoryContext;
  const postRun = task.executionMemoryPostRun;

  if (context === undefined && postRun === undefined) {
    return null;
  }

  const topCandidates = context?.topCandidates ?? [];
  const injectedCount = topCandidates.filter((c) => c.passedThreshold).length;
  const belowThresholdCount = topCandidates.length - injectedCount;

  return (
    <Card className="mb-6">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Execution Memory</h3>
        {context?.status !== undefined ? (
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${EXECUTION_MEMORY_STATUS_STYLES[context.status]}`}>
            {context.status}
          </span>
        ) : null}
      </div>

      {context?.querySummary !== undefined ? (
        <div className="mb-3 text-sm text-slate-600 dark:text-slate-300">
          <MarkdownContent content={context.querySummary} />
        </div>
      ) : null}

      {/* Summary stats banner */}
      {topCandidates.length > 0 ? (
        <div className="mb-4 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {context?.totalSearchResults !== undefined
            ? `${String(context.totalSearchResults)} memories searched · ${String(injectedCount)} injected · ${String(belowThresholdCount)} below threshold`
            : `${String(topCandidates.length)} candidates shown`}
        </div>
      ) : null}

      {/* Unified candidate list */}
      {topCandidates.length > 0 ? (
        <div className="mb-4 space-y-2">
          {topCandidates.map((candidate) => {
            const matchedMemory = context?.matchedMemories?.find((m) => m.memoryId === candidate.memoryId);
            return (
              <div
                key={candidate.memoryId}
                className={`rounded-lg border p-3 ${
                  candidate.passedThreshold
                    ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/30'
                    : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/40'
                }`}
              >
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    candidate.passedThreshold
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'
                      : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                  }`}>
                    {candidate.passedThreshold ? 'Injected' : 'Candidate'}
                  </span>
                  <span className="font-medium text-slate-900 dark:text-slate-100">{candidate.title}</span>
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                    {candidate.memoryType}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className={`font-mono font-medium ${
                    candidate.passedThreshold
                      ? 'text-emerald-700 dark:text-emerald-300'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}>
                    {candidate.rerankScore.toFixed(3)}
                  </span>
                  <span title="Vector score">V:{candidate.vectorScore.toFixed(2)}</span>
                  <span title="Component overlap">C:{candidate.componentOverlap.toFixed(2)}</span>
                  <span title="Effectiveness">E:{candidate.effectiveness.toFixed(2)}</span>
                </div>
                {candidate.passedThreshold && matchedMemory !== undefined ? (
                  <div className="mt-2 space-y-1 text-sm">
                    <div className="text-slate-600 dark:text-slate-300"><MarkdownContent content={matchedMemory.appliesWhen} /></div>
                    <div className="text-slate-700 dark:text-slate-200"><MarkdownContent content={matchedMemory.action} /></div>
                    <div className="text-slate-500 dark:text-slate-400"><MarkdownContent content={matchedMemory.avoid} /></div>
                    <div className="text-slate-500 dark:text-slate-400"><MarkdownContent content={matchedMemory.verification} /></div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {postRun !== undefined ? (
        <div className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-900 dark:text-slate-100">Post-run status</span>
            <span>{postRun.status}</span>
          </div>
          {postRun.evaluationSummary !== undefined ? (
            <MarkdownContent content={postRun.evaluationSummary} />
          ) : null}
          {postRun.generatedMemoryIds.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-slate-900 dark:text-slate-100">Generated memories</span>
              {postRun.generatedMemoryIds.map((memoryId) => (
                <span
                  key={memoryId}
                  className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
                >
                  {memoryId}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
});
```

Key design decisions:
- `topCandidates` is the unified list — each item either has `passedThreshold: true` (Injected) or `false` (Candidate)
- For injected candidates, look up full detail from `matchedMemories` by `memoryId`
- Stats banner uses `totalSearchResults` when available, falls back gracefully for old data
- `String()` wrapping satisfies TypeScript strict template literal rules

- [ ] **Step 6: Run tests to verify they pass**

```bash
pnpm run verify:workspace:tracked -- web
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/CodeTaskViewPage.tsx
git add apps/web/src/__tests__/CodeTaskViewPage.executionMemory.test.tsx
git commit -m "feat(web): redesign execution memory card with Injected/Candidate badges and stats banner"
```

---

### Task 5: Update `TaskHeader` chip to show injected/shown counts

**Files:**
- Modify: `apps/web/src/components/code-tasks/TaskHeader.tsx:40-46`
- Test: `apps/web/src/components/code-tasks/__tests__/TaskHeader.executionMemory.test.tsx`

- [ ] **Step 1: Write a failing test for the new chip text**

In `TaskHeader.executionMemory.test.tsx`, update the test for the `'matched'` state. Currently it asserts `"Memory: 2 matches"`. Change it to assert `"Memory: 2 injected, 5 shown"` (or whatever the fixture data produces).

Add a test fixture with `topCandidates` that has mixed `passedThreshold` values:

```typescript
it('renders injected and shown counts in chip', () => {
  const { container } = render(
    <TaskHeader
      task={createTask({
        executionMemoryContext: {
          status: 'matched',
          matchedMemories: [
            { memoryId: 'mem-1', title: 'M1', memoryType: 'verification_pattern', score: 0.91, appliesWhen: 'x', action: 'y', avoid: 'z', verification: 'v' },
          ],
          topCandidates: [
            { memoryId: 'mem-1', title: 'M1', memoryType: 'verification_pattern', vectorScore: 0.8, rerankScore: 0.91, componentOverlap: 0.5, effectiveness: 0.7, passedThreshold: true },
            { memoryId: 'mem-2', title: 'M2', memoryType: 'pitfall_pattern', vectorScore: 0.6, rerankScore: 0.45, componentOverlap: 0.3, effectiveness: 0.4, passedThreshold: false },
            { memoryId: 'mem-3', title: 'M3', memoryType: 'pitfall_pattern', vectorScore: 0.5, rerankScore: 0.40, componentOverlap: 0.2, effectiveness: 0.3, passedThreshold: false },
          ],
        },
      })}
    />
  );
  expect(screen.getByText('Memory: 1 injected, 3 shown')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm run verify:workspace:tracked -- web
```

Expected: FAIL — chip shows old text format.

- [ ] **Step 3: Update the chip logic in `TaskHeader.tsx`**

Replace lines 40-46:

```typescript
const executionMemoryChip = task.executionMemoryContext === undefined
  ? null
  : task.executionMemoryContext.status === 'matched'
    ? `Memory: ${String(task.executionMemoryContext.matchedMemories?.length ?? 0)} matches`
    : task.executionMemoryContext.status === 'none'
      ? 'Memory: none'
      : 'Memory: error';
```

With:

```typescript
const executionMemoryChip = task.executionMemoryContext === undefined
  ? null
  : task.executionMemoryContext.status === 'matched' || task.executionMemoryContext.status === 'none'
    ? (() => {
        const candidates = task.executionMemoryContext.topCandidates ?? [];
        const injected = candidates.filter((c) => c.passedThreshold).length;
        return candidates.length > 0
          ? `Memory: ${String(injected)} injected, ${String(candidates.length)} shown`
          : 'Memory: none';
      })()
    : 'Memory: error';
```

This handles:
- `matched` with candidates → `"Memory: 2 injected, 5 shown"`
- `none` with candidates (below threshold) → `"Memory: 0 injected, 3 shown"`
- `none` without candidates → `"Memory: none"`
- `error` → `"Memory: error"`

- [ ] **Step 4: Update existing tests that check old chip text**

Find all assertions for `"Memory: 2 matches"` or `"Memory: N matches"` in the test file and update them to match the new format. For example, if the old test had 2 matched memories and 3 top candidates (2 passed threshold), it should now assert `"Memory: 2 injected, 3 shown"`.

- [ ] **Step 5: Run tests to verify all pass**

```bash
pnpm run verify:workspace:tracked -- web
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/code-tasks/TaskHeader.tsx
git add apps/web/src/components/code-tasks/__tests__/TaskHeader.executionMemory.test.tsx
git commit -m "feat(web): update TaskHeader memory chip to show injected/shown counts"
```

---

### Task 6: Final CI verification

- [ ] **Step 1: Build all packages**

```bash
pnpm build
```

- [ ] **Step 2: Run full CI**

```bash
pnpm run ci:tracked
```

Expected: PASS — all workspaces green.

- [ ] **Step 3: Commit any remaining fixes if needed**

---

### Endpoint Changes

- **Modified:** None
- **Created:** None
- **Removed:** None
- **Unchanged:** All existing endpoints. The `totalSearchResults` field is added to the Firestore document (code task's `executionMemoryContext`) which is already served by the existing task detail endpoint.

### Key Decisions

- `passedThreshold` on `topCandidates` is the source of truth for whether a memory was injected into the prompt
- `totalSearchResults` is populated from `reranked.length` (post-vector-search, post-rerank count) — this represents how many candidates were actually scored
- No new Firestore collections — the existing `ExecutionMemoryContext` on the code task document carries all data
- `TOP_CANDIDATES_LIMIT = 5` already exists in the backend — no constant changes needed
- The frontend's unified candidate list uses `topCandidates` as the single iteration source, looking up `matchedMemories` by `memoryId` for detail expansion on injected items
- Backward compatibility: when `totalSearchResults` is `undefined` (old tasks), the stats banner falls back to showing `"{N} candidates shown"`
