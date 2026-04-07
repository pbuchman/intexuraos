# Execution Memory Retrieval Quality Improvements

**Date:** 2026-04-08
**Status:** Draft

## Problem Statement

Investigation of task `task_e83430ae-4cc0-45ea-ad2b-3927024c86c1` revealed systemic failures in the execution memory retrieval pipeline:

1. **Corrupted embeddings** — 5 memories have zero/null embedding vectors causing `vectorScore=1.0` against any query. They monopolize the top-20 candidate slots in every retrieval, crowding out genuinely relevant memories.
2. **Broken component overlap** — `overlapRatio()` does exact string matching, but query components are multi-word phrases (`"code tasks filter"`) while componentHints are single-word identifiers (`"firestore"`). Result: 25% of scoring weight is always zero.
3. **No observability for near-misses** — Application records only store memories that passed the threshold. Debugging requires ephemeral logs that are often unavailable.
4. **Missing prompt constraints** — The query normalization prompt doesn't instruct the LLM to produce single-word/hyphenated component identifiers matching the componentHints vocabulary.
5. **Threshold too high** — `MIN_RERANK_SCORE=0.55` combined with broken component overlap means even semantically relevant memories (vectorScore ~0.59) can't pass.
6. **Memory bloat** — 608 active memories, 99% never applied, 0 suppressed. Near-duplicate merge threshold (0.94) is too conservative.

**Evidence:**
- 334 retrieval applications: 260 no_match (78%), 42 matched (13%), 32 error (10%)
- 603/608 memories never applied
- Only 1 positive evaluation out of 10 total applications
- The same 5 corrupted memories appear in every matched application with vectorScore=1.0

## Fixes

### Fix 1: Delete Corrupted Memories

Delete all execution memories where vector search consistently returns `cosineDistance=0` (vectorScore=1.0). These have corrupted/zero embedding vectors.

**Known corrupted memory IDs:**
- `mem_1cc9e496-179b-43be-8292-1d43ab140f26`
- `mem_60538ec6-24b7-440c-aaa8-c875ab2bf924`
- `mem_99413905-cde2-4a84-b007-b0dcce3b235a`
- `mem_4ee596d9-5e3b-4c98-879a-32169a8abb12`
- `mem_faf3aaab-287f-4ddb-9219-694e60295870`

**Implementation:** One-time migration script that:
1. Queries all active memories for the repository
2. Embeds a known test phrase
3. Runs `findNearest` and identifies memories with `vectorDistance=0`
4. Deletes them from Firestore

### Fix 2: Tokenize Component Overlap

Change `overlapRatio()` in `prepareExecutionMemoryContext.ts` to tokenize both sides into individual terms before matching, using the existing `tokenize()` function (splits on non-alphanumeric, keeps tokens >= 4 chars).

**Before:** `"firestore data"` vs `"firestore"` → no match
**After:** `["firestore", "data"]` vs `["firestore"]` → overlap = 1

### Fix 3: Store Top 5 Candidates in Application Records

Extend the application record to store the **top 5 candidates** regardless of whether they passed the threshold.

**Changes:**
- Add `topCandidates` field to `ExecutionMemoryApplicationMatch[]` on the application model — each includes `memoryId`, `title`, `memoryType`, `vectorScore`, `rerankScore`, `componentOverlap`, `effectiveness`, `passedThreshold`
- Add `topCandidates` to `CreateExecutionMemoryApplicationInput`
- Store in `prepareExecutionMemoryContext.ts` during application creation
- Add `topCandidates` to `CodeTask.executionMemoryContext` so it's available in the web app
- Display in `CodeTaskViewPage.tsx`: show matched memories as today, plus a "Near Misses" section for candidates that didn't pass threshold, with score breakdown

**Web app type changes:**
- Add `decomposition_pattern`, `planning_decision`, `review_finding` to `CodeTaskExecutionMemoryMatch.memoryType`
- Add `topCandidates` array to `CodeTaskExecutionMemoryContext`

**Candidate shape on CodeTask:**
```typescript
interface ExecutionMemoryCandidate {
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

### Fix 4: Constrain Query Normalization Prompt

Update `buildNormalizationPrompt()` to include explicit instructions for the `components` field:

```
components: Use single-word or hyphenated canonical identifiers matching service/module names.
Examples: "code-agent", "firestore", "routing", "testing", "web-app", "orchestrator".
Do NOT use multi-word descriptive phrases like "code tasks filter" or "issue-groups API endpoint".
```

Also update the fallback normalization to produce the same vocabulary (it already tokenizes, which is correct).

### Fix 5: Lower MIN_RERANK_SCORE to 0.50

Change `MIN_RERANK_SCORE` from `0.55` to `0.50` in `prepareExecutionMemoryContext.ts`.

With component overlap fixed, a legitimate match scores:
```
0.55 × 0.59 + 0.25 × 0.5 + 0.20 × 0.5 = 0.325 + 0.125 + 0.10 = 0.55 → passes at 0.50
```

### Fix 6: Lower Near-Duplicate Merge Threshold + Dedup Migration

**Runtime change:** Lower `vectorScore >= 0.94` to `vectorScore >= 0.88` in `processExecutionMemoryBacklog.ts` for near-duplicate detection during memory creation.

**One-time migration:** Script that:
1. Loads all active memories for the repository
2. For each memory, embeds its `retrievalText` and finds nearest neighbors
3. Groups memories with same `memoryType` and `vectorScore >= 0.88`
4. For each group, keeps the one with highest `qualityScore` and deletes/suppresses the rest
5. Logs all actions taken

## Files Changed

### Modified
- `apps/code-agent/src/domain/usecases/prepareExecutionMemoryContext.ts` — Fix 2, 3, 4, 5
- `apps/code-agent/src/domain/usecases/processExecutionMemoryBacklog.ts` — Fix 6
- `apps/code-agent/src/domain/models/codeTask.ts` — Fix 3 (add topCandidates to ExecutionMemoryContext)
- `apps/code-agent/src/domain/models/executionMemoryApplication.ts` — Fix 3 (add topCandidates to model)
- `apps/code-agent/src/domain/repositories/executionMemoryApplicationRepository.ts` — Fix 3 (add topCandidates to create input)
- `apps/web/src/types/index.ts` — Fix 3 (add topCandidates + missing memoryType values)
- `apps/web/src/pages/CodeTaskViewPage.tsx` — Fix 3 (render candidates)

### Created
- Migration script for Fix 1 (delete corrupted memories)
- Migration script for Fix 6 (dedup pass)

### Unchanged
- `apps/code-agent/src/infra/repositories/firestoreExecutionMemoryRepository.ts` — no schema changes needed, Firestore is schemaless
- `apps/code-agent/src/infra/repositories/firestoreExecutionMemoryApplicationRepository.ts` — stores what's passed in, no schema changes needed

## Endpoint Changes

- **Modified:** None (memory retrieval is internal, not an API endpoint)
- **Created:** None
- **Removed:** None
- **Unchanged:** All existing endpoints

## Testing Strategy

- Unit tests for tokenized `overlapRatio()` — verify multi-word phrases match single-word hints
- Unit tests for `rerankMemories()` with new threshold
- Update existing tests that assert on application creation to include `topCandidates`
- Web app: no coverage enforcement per CLAUDE.md
- Migration scripts: manual execution, not automated tests
