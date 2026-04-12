# INT-1352: Execution Memory Injection Evaluation

> **Investigation Report** - Analysis of the last 50 code tasks to evaluate execution memory retrieval, injection, and feedback loop effectiveness.

**Date:** 2026-04-12
**Data Sources:** Firestore `code_tasks`, `execution_memories`, `execution_memory_applications` collections; GCP Cloud Run logs for `intexuraos-code-agent`

---

## Executive Summary

Execution memory retrieval is **operational and broadly active** across all eligible agent types. Of 50 tasks analyzed, 48 (96%) had retrieval attempted, and 32 (64%) received at least one injected memory. However, the investigation uncovered **three critical systemic issues** that severely undermine the feedback loop and memory quality evolution:

1. **Workers never report memory usage** - 0 of 40 completed tasks reported which memories they used (all `execution_memory_ids_used` fields are empty strings)
2. **All per-memory evaluation outcomes are `unknown`** - The evaluator cannot determine positive/negative impact because it has no worker self-report to cross-reference
3. **Post-run processing failures** - 7 of 50 tasks (14%) have permanent `error` status due to upstream service unavailability (500/503 from Gemini)

The net effect: the system generates and injects memories but **cannot learn which ones are helpful**. The quality feedback loop is broken.

---

## High-Level Statistics

| Metric                                | Value      | Notes                               |
| ------------------------------------- | ---------- | ----------------------------------- |
| Tasks analyzed                        | 50         | Apr 10-12, 2026                     |
| Retrieval attempted                   | 48 (96%)   | 2 tasks ineligible (`ask_agent`)    |
| Memories injected (>= 1)              | 32 (64%)   | Passed 0.50 rerank threshold        |
| No match (candidates below threshold) | 16 (32%)   | Had 20 candidates, none qualified   |
| Avg top candidate rerank score        | 0.539      | Range: 0.427 - 0.682                |
| Tasks with 3 memories injected        | 16 (32%)   | Maximum allowed                     |
| Tasks with 2 memories injected        | 7 (14%)    |                                     |
| Tasks with 1 memory injected          | 9 (18%)    |                                     |
| Worker self-reported usage            | **0 (0%)** | **CRITICAL: Broken feedback loop**  |
| Post-run completed                    | 29 (58%)   |                                     |
| Post-run errored                      | 7 (14%)    | Service unavailability              |
| Post-run skipped                      | 5 (10%)    | `already_completed` or `infra_only` |
| Post-run missing/pending              | 9 (18%)    | Still running or incomplete         |
| New memories generated                | 78         | From 29 completed post-runs         |

### Memory Corpus

| Metric                           | Value     |
| -------------------------------- | --------- |
| Active memories                  | 990       |
| Suppressed memories              | 0         |
| Memories never applied           | 911 (92%) |
| Total applications across corpus | 191       |
| Positive evaluations             | 117       |
| Negative evaluations             | 5         |

### Agent Type Distribution

| Agent Type   | Count   | With Injection   | % Injected       |
| ------------ | ------- | ---------------- | ---------------- |
| review       | 26      | 15               | 58%              |
| remediation  | 13      | 10               | 77%              |
| planning     | 4       | 4                | 100%             |
| execution    | 3       | 2                | 67%              |
| pull_request | 3       | 1                | 33%              |
| ask_agent    | 1       | 0                | N/A (ineligible) |

---

## Detailed Task Evidence Table

The following table shows every task where execution memory found at least one candidate to inject (32 tasks). Columns:
- **Task** - Task ID (truncated) and Linear issue
- **Agent** - Agent type (P=planning, E=execution, R=review, M=remediation, PR=pull_request)
- **Inj** - Number of memories injected (passed >= 0.50 threshold)
- **Top Score** - Highest rerank score among candidates
- **Top Memory Title** - Title of the highest-scoring memory
- **Post-Run** - Post-run processing status and evaluation outcome
- **Worker Report** - Whether the worker reported memory usage

| #   | Task ID         | Issue    | Agent   | Inj   | Top Score   | Top Injected Memory                                                              | Post-Run   | Worker Report   |
| --- | --------------- | -------- | ------- | ----- | ----------- | -------------------------------------------------------------------------------- | ---------- | --------------- |
| 1   | `task_002..ebc` | INT-1352 | P       | 3     | 0.572       | Extend ExecutionMemoryContext with search results count                          | pending    | N/A (running)   |
| 2   | `task_74d..479` | INT-1351 | E       | 3     | 0.620       | Add test cases for Firestore index aggregation with '__name__'                   | pending    | N/A (running)   |
| 3   | `task_534..efe` | INT-1349 | M       | 1     | 0.535       | Comprehensive Verification of Existing Fixes and Code Quality                    | pending    | N/A (running)   |
| 4   | `task_461..010` | INT-1351 | R       | 1     | 0.534       | Creating complex data migrations without dedicated test coverage                 | completed  | empty `""`      |
| 5   | `task_b36..70f` | INT-1349 | R       | 3     | 0.601       | Safe execution guard for scheduled tasks with pending review items               | completed  | empty `""`      |
| 6   | `task_84f..5ae` | INT-1351 | P       | 3     | 0.674       | Creating complex data migrations without dedicated test coverage                 | completed  | empty `""`      |
| 7   | `task_89a..fff` | INT-1350 | R       | 2     | 0.585       | Decompose cleanup broadly after feature deletion/migration                       | completed  | empty `""`      |
| 8   | `task_c4e..72d` | INT-1350 | M       | 3     | 0.590       | Decompose cleanup broadly after feature deletion/migration                       | completed  | empty `""`      |
| 9   | `task_c61..762` | INT-1349 | E       | 2     | 0.591       | Safe execution guard for scheduled tasks with pending review items               | completed  | empty `""`      |
| 10  | `task_923..643` | INT-1349 | M       | 3     | 0.544       | Comprehensive Verification of Existing Fixes and Code Quality                    | skipped    | empty `""`      |
| 11  | `task_c45..1bd` | INT-1350 | M       | 2     | 0.511       | Stale JSDoc comments after service migration                                     | completed  | empty `""`      |
| 12  | `task_e7f..343` | INT-1349 | R       | 3     | 0.625       | Safe execution guard for scheduled tasks with pending review items               | completed  | empty `""`      |
| 13  | `task_1ed..cec` | INT-1349 | M       | 2     | 0.562       | Comprehensive Verification of Existing Fixes and Code Quality                    | completed  | empty `""`      |
| 14  | `task_8eb..b79` | INT-1350 | P       | 3     | 0.555       | Prevent accidental reintroduction of deleted code after merge conflicts          | completed  | empty `""`      |
| 15  | `task_f8d..cd2` | INT-1349 | P       | 1     | 0.538       | Incomplete State Management for Workflow Edge Cases                              | completed  | empty `""`      |
| 16  | `task_4ba..92d` | INT-1348 | M       | 1     | 0.537       | Shift cost calculation client-side, use atomic deprecation for pricing API       | completed  | empty `""`      |
| 17  | `task_55e..404` | INT-1348 | R       | 1     | 0.525       | Decompose Automated PR Action Investigations                                     | completed  | empty `""`      |
| 18  | `task_65d..033` | INT-1347 | M       | 1     | 0.568       | Shift cost calculation client-side, use atomic deprecation for pricing API       | skipped    | empty `""`      |
| 19  | `task_997..4ff` | INT-1347 | R       | 2     | 0.555       | Comprehensive Verification of Existing Fixes and Code Quality                    | completed  | empty `""`      |
| 20  | `task_f0e..f97` | N/A      | PR      | 3     | 0.601       | Verify pre-resolved merge conflicts and PR readiness                             | missing    | empty `""`      |
| 21  | `task_7e1..c58` | INT-1342 | R       | 3     | 0.576       | Auto-merge Planning PRs on Review Pass                                           | **error**  | empty `""`      |
| 22  | `task_4e3..735` | INT-1342 | R       | 3     | 0.606       | Auto-merge Planning PRs on Review Pass                                           | missing    | N/A             |
| 23  | `task_c15..681` | N/A      | R       | 3     | 0.567       | Comprehensive Verification of Existing Fixes and Code Quality                    | completed  | empty `""`      |
| 24  | `task_e20..bac` | N/A      | R       | 1     | 0.562       | Standardize Nitpick Nuker comment processing and reaction handling               | completed  | empty `""`      |
| 25  | `task_2ee..6c0` | INT-1343 | R       | 2     | 0.604       | Standardize Nitpick Nuker comment processing and reaction handling               | **error**  | empty `""`      |
| 26  | `task_57b..0a5` | INT-750  | M       | 3     | 0.651       | Recover from `gh` CLI permission errors with `gh api`                            | missing    | N/A             |
| 27  | `task_67a..bed` | INT-1343 | R       | 3     | 0.627       | Auto-merge Planning PRs on Review Pass                                           | **error**  | empty `""`      |
| 28  | `task_41b..e4`  | INT-1339 | R       | 1     | 0.519       | Shift cost calculation client-side, use atomic deprecation for pricing API       | **error**  | empty `""`      |
| 29  | `task_6a4..963` | INT-750  | M       | 2     | 0.511       | Handle `git push` failures when local branch name doesn't match remote PR branch | **error**  | empty `""`      |
| 30  | `task_ef1..e6`  | INT-750  | M       | 3     | 0.587       | Auto-merge Planning PRs on Review Pass                                           | missing    | N/A             |
| 31  | `task_bef..be1` | INT-1340 | R       | 1     | 0.509       | Route orchestrator usage via code-agent webhook gateway                          | completed  | empty `""`      |
| 32  | `task_e20..bac` | N/A      | R       | 1     | 0.562       | Standardize Nitpick Nuker comment processing and reaction handling               | completed  | empty `""`      |

---

## Critical Findings

### Finding 1: Workers Never Report Memory Usage (CRITICAL)

**Evidence:** All 40 completed tasks with a `result` field have `execution_memory_ids_used: ""` (empty string). Zero tasks have non-empty values.

**Root Cause:** The orchestrator system prompt instructs workers to include `execution_memory_ids_used` in their final completion block. However, the completion verifier schema (`completion-verifier.ts`) defines `memory_ids_used` with `.optional().default('')`. When workers don't include the field (or include it as empty), the default kicks in, and the empty string propagates through the entire pipeline.

The actual worker agents (Claude Code) appear to **not be reporting memory usage in their final blocks**. This could be because:
- The memory acknowledgment prompt section is advisory and workers skip it under pressure
- The final block format varies by agent type (planning, execution, review, remediation, pull_request) and each has its own schema - memory reporting may not be consistently required across all
- Workers may acknowledge memories in their conversation but fail to include the IDs in the structured completion block

**Impact:** Without worker self-report, the evaluation pipeline cannot determine whether a memory was actually used. All `perMemoryOutcome` values are `unknown` (28 of 28 checked). The quality scoring mechanism (`qualityScore = 0.50 * effectiveness + 0.30 * confidence + 0.20 * recency`) cannot evolve because `effectiveness = (positiveCount + 1) / (applicationCount + 2)` stays at the Laplace prior. The suppression policy (`negativeCount/applicationCount >= 0.5`) can never trigger.

**Recommendation:**
1. Make `memory_ids_used` a **required** field in all completion block schemas (not optional with empty default)
2. Add a completion verifier validation that flags missing memory reporting when memories were injected
3. Consider having the orchestrator parse the conversation for memory acknowledgment markers as a backup signal

### Finding 2: Post-Run Processing Failures Due to Service Unavailability

**Evidence:** 7 tasks stuck in `error` state, all with the same error pattern:

```
"error": {"message": "Service Unavailable"}
"error": {"message": "<html>...500 Server Error..."}
```

**Affected Tasks:**
- `task_7e15a3ba` (INT-1342, review) - 3 retries, all failed
- `task_2ee2aa96` (INT-1343, review) - 3 retries, all failed
- `task_cf615856` (INT-1343, remediation) - 3 retries, all failed
- `task_67aab694` (INT-1343, review) - 3 retries, all failed
- `task_1e8a86a3` (INT-750, review) - 3 retries, all failed
- `task_6a4d4a97` (INT-750, remediation) - 3 retries, all failed
- `task_41b1fee4` (INT-1339, review) - 3 retries, all failed

**Root Cause:** The post-run processor calls Gemini 2.5 Flash for distillation and evaluation. During Apr 11 08:00-11:30 UTC, Gemini returned 500/503 errors. The processor retries up to 3 times, but all 3 attempts hit the same outage window, leaving tasks permanently stuck in `error`.

**Impact:** 7 tasks never generated new memories and never evaluated their matched memories. These are permanently lost data points.

**Recommendation:**
1. Increase retry count beyond 3, or add exponential backoff with longer windows
2. Add a periodic "sweep" job that retries tasks stuck in `error` state after 24 hours
3. Consider circuit-breaker logic: if Gemini is returning 503s, delay processing rather than consuming all retries immediately

### Finding 3: Evaluator Reports Unknown Memory IDs

**Evidence:** 9 log entries of `"Evaluator returned outcome for unknown memory ID, skipping"` across 8 distinct tasks. The memory IDs in these logs appear to be truncated or corrupted versions of valid IDs.

Example from logs:
- Expected: `mem_d2999121-0694-413d-adb0-35e45223c8d6`
- Got: `mem_d2999121-0694-413d-adb0-35e4223c8d6` (missing character)

**Root Cause:** The Gemini evaluator LLM is asked to return memory IDs in its structured output. It sometimes hallucinates slightly different IDs (off-by-one characters in UUID segments). The code then looks up this ID in the matched memories map and fails to find it.

**Impact:** Evaluation outcomes are silently dropped for these memories, further degrading the feedback loop.

**Recommendation:**
1. Add fuzzy matching for memory IDs returned by the evaluator (e.g., Levenshtein distance <= 2)
2. Alternatively, use indexed references ("Memory 1", "Memory 2") instead of asking the LLM to reproduce UUIDs
3. Add the full memory ID list to the evaluator prompt context with numbered indices

### Finding 4: High False-Positive Rate for Generic Memories

**Evidence from post-run evaluations:**

Several memories are injected frequently but consistently found irrelevant:
- `mem_9ab7a7b4` "Auto-merge Planning PRs on Review Pass" - matched to 5+ review tasks but evaluation says it's not applicable to code review tasks
- `mem_5992a378` "Standardize Nitpick Nuker comment processing" - matched to generic review tasks where Nitpick Nuker isn't involved
- `mem_86c0e2fa` "Shift cost calculation client-side, use atomic deprecation for pricing API" - matched to remediation tasks unrelated to pricing
- `mem_23165d03` "Comprehensive Verification of Existing Fixes and Code Quality" - matches everything due to generic phrasing, but evaluation notes it's not always applicable

**Root Cause:** The reranking weights (55% vector similarity, 25% component overlap, 20% effectiveness) are dominated by vector similarity. Generic memories with broad language ("comprehensive verification", "code quality") have high cosine similarity to many queries. The effectiveness signal (which should down-weight false positives) is inert because the feedback loop is broken (Finding 1).

**Recommendation:**
1. Fix the feedback loop first (Finding 1) - effectiveness scores will naturally suppress false positives
2. Consider increasing the rerank threshold from 0.50 to 0.55 for `review` agent types, which have the highest false-positive rate
3. Add negative examples to the reranking: memories previously evaluated as `neutral` or `negative` should get a penalty

### Finding 5: 92% of Memory Corpus is Never Applied

**Evidence:** 911 of 990 active memories have `applicationCount = 0`. Only 79 memories have ever been matched and injected.

**Root Cause:** The corpus grows via distillation from every completed task (~2.7 memories per task), but the retrieval pipeline returns at most 3 per task from a pool of 20 nearest neighbors. With 990 memories, the long tail never surfaces.

**Recommendation:**
1. Implement periodic corpus pruning: memories with `applicationCount = 0` and `age > 30 days` should be candidates for archival
2. Consider diversity injection: randomly sample 1 low-application memory alongside the top-3 reranked results
3. Review the distillation quality gate - generating 2.7 memories per task may be too aggressive

---

## Positive Findings

Despite the critical issues, the retrieval system demonstrates clear value in several cases:

1. **Highly targeted matches for Firestore migrations** (tasks 2, 4, 6): `mem_d2999121` "Creating complex data migrations without dedicated test coverage" was correctly matched with scores 0.53-0.67 and post-run evaluation confirmed it "directly influenced" the planning agent's decision to add test steps

2. **Domain-specific pattern reuse** (task 9): `mem_9cd061af` "Safe execution guard for scheduled tasks" was created by a planning task and correctly retrieved for the subsequent execution task implementing the same feature, with evaluation confirming both matched memories "directly informed the implementation"

3. **Cross-task learning** (task 15): The "Incomplete State Management for Workflow Edge Cases" memory was distilled from an earlier task and correctly matched to a planning task for a UI status indicator, where it influenced the handling of error states

---

## Recommended Improvements (Priority Order)

| Priority   | Issue                              | Action                                                                 | Expected Impact                         |
| ---------- | ---------------------------------- | ---------------------------------------------------------------------- | --------------------------------------- |
| P0         | Workers never report memory usage  | Make `memory_ids_used` required in completion verifier; add validation | Unblocks the entire feedback loop       |
| P0         | All perMemoryOutcome are `unknown` | Consequence of P0 above; will resolve automatically                    | Enables quality scoring and suppression |
| P1         | Post-run errors are permanent      | Add sweep job for `error` status after 24h; increase retry budget      | Recovers 14% of lost evaluations        |
| P1         | Evaluator hallucinates memory IDs  | Use indexed references instead of UUIDs in evaluator prompt            | Eliminates silent evaluation drops      |
| P2         | Generic memories dominate matches  | Increase threshold for review agents; add effectiveness penalty        | Reduces false positive injection        |
| P2         | 92% of corpus never applied        | Add periodic pruning for aged, zero-application memories               | Improves retrieval signal-to-noise      |
| P3         | No diversity in retrieval          | Sample 1 random low-app memory alongside top-3                         | Surfaces long-tail memories             |
