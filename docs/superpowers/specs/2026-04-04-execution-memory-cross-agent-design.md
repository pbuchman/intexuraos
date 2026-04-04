# Execution Memory Cross-Agent Extension — Design Spec

**Date:** 2026-04-04
**Service:** code-agent, orchestrator (prompt only)
**Linear:** INT-1257

## Overview

Extend the execution memory system to serve all three primary agent types (execution, planning, review) instead of only the execution agent. All agents share a single memory pool — planning agents contribute decomposition and complexity-classification patterns, review agents contribute recurring code quality/security/architecture findings, and all agents retrieve from the shared pool. This creates a cross-pollination feedback loop where lessons from any phase improve every phase.

## Problem

Today execution memory only operates on `agentType === 'execution'`:

1. **Planning agents repeat mistakes.** A planning agent that decomposes an issue into subtasks with missing service boundaries has no way to learn from prior decompositions. The same classification errors (SIMPLE vs COMPLEX) recur across issues.
2. **Review findings are ephemeral.** Code reviews flag recurring patterns (missing error handling, DRY violations, security issues) but these findings live only in GitHub PR comments. Execution agents implementing similar features hit the same review findings again.
3. **No feedback loop across phases.** A review finding about a pattern (e.g., "Firestore composite indexes needed for multi-field queries") could prevent the same issue from appearing in future execution tasks, but there's no mechanism to propagate it.

## Solution

### 1. Data Model Changes

#### 1a. New Memory Types

Extend `ExecutionMemoryType` in `apps/code-agent/src/domain/models/executionMemory.ts`:

```typescript
export type ExecutionMemoryType =
  // Existing (execution-sourced)
  | 'implementation_pattern'
  | 'verification_pattern'
  | 'pitfall_pattern'
  // New (planning-sourced)
  | 'decomposition_pattern'    // How complex issues are broken into subtasks
  | 'planning_decision'        // Complexity classification heuristics
  // New (review-sourced)
  | 'review_finding';          // Recurring code quality/security/architecture patterns
```

**Rationale for each new type:**

- `decomposition_pattern`: Captures how a complex issue was broken into independent subtasks — service boundaries, parallelization strategy, subtask count. Retrieved by future planning agents facing similar issues.
- `planning_decision`: Captures complexity classification heuristics — what indicators predict SIMPLE vs PLAN-DOC vs COMPLEX. Retrieved by planning agents during complexity judgment.
- `review_finding`: Captures recurring patterns that reviewers flag — security issues, architecture violations, test quality problems. Retrieved by execution agents to prevent the finding from occurring in the first place.

#### 1b. New Field: `sourceAgentType`

Add to `ExecutionMemory` interface:

```typescript
sourceAgentType: 'execution' | 'planning' | 'review';
```

Purpose: observability and potential future retrieval weighting. Not used for gating behavior. Existing memories without this field are treated as `'execution'` at read time — no Firestore migration needed. The repository layer maps `undefined` to `'execution'` on read.

#### 1c. New Webhook Result Fields for Review Content

Add to `TaskCompleteWebhookBody.result` in `webhookRoutes.ts`:

```typescript
review_body?: string;             // Full review summary text
review_inline_comments?: string;  // JSON-serialized [{path, line, body}]
```

The orchestrator captures the review body and inline comments it constructs before posting them to GitHub, and includes them in the webhook callback payload. This keeps the distillation path self-contained — no GitHub API dependency during async backlog processing.

### 2. Gate Changes

Four locations currently gate on `agentType === 'execution'`. All change to use a shared eligibility check.

#### 2a. Shared Utility

Create `apps/code-agent/src/domain/utils/memoryEligibility.ts`:

```typescript
const MEMORY_ELIGIBLE_AGENTS = new Set(['execution', 'planning', 'review']);

export function isMemoryEligibleAgent(
  agentType: string | undefined // @allow-undefined-type -- mirrors existing CodeTask.agentType
): boolean {
  return agentType !== undefined && MEMORY_ELIGIBLE_AGENTS.has(agentType);
}
```

#### 2b. Pre-Run Retrieval Gates

**File:** `apps/code-agent/src/domain/usecases/drainTaskQueue.ts` (line 374)
**File:** `apps/code-agent/src/domain/usecases/drainRetryQueue.ts` (line 258)

Change:
```typescript
&& agentType === 'execution'
```
To:
```typescript
&& isMemoryEligibleAgent(agentType)
```

#### 2c. Post-Run Queueing Gate

**File:** `apps/code-agent/src/routes/webhookRoutes.ts` (line 60, `shouldQueueExecutionMemoryPostRun`)

Change:
```typescript
&& params.agentType === 'execution'
```
To:
```typescript
&& isMemoryEligibleAgent(params.agentType)
```

#### 2d. Agent-Aware Distillation Skip

**File:** `apps/code-agent/src/domain/usecases/processExecutionMemoryBacklog.ts` (line 198)

Replace the hardcoded `execution_outcome_label === 'already_completed'` check with an agent-aware function:

```typescript
function shouldSkipDistillation(task: CodeTask): {
  skip: boolean;
  reason?: 'already_completed' | 'planning_unclear';
} {
  if (task.result?.execution_outcome_label === 'already_completed') {
    return { skip: true, reason: 'already_completed' };
  }
  if (task.agentType === 'planning' && task.result?.planning_outcome_label === 'unclear') {
    return { skip: true, reason: 'planning_unclear' };
  }
  return { skip: false };
}
```

Reasoning: Unclear planning outcomes are requests for clarification — they don't contain reusable patterns. All completed reviews have signal (even "no issues found" reviews confirm patterns are being followed).

### 3. Agent-Specific Distillation Prompts

The current distillation prompt in `processExecutionMemoryBacklog.ts` is execution-specific (references `task.result.summary`, generic logs). We create **per-agent distillation prompt builders** that feed into the same `DistillationSchema` validation.

#### 3a. Distillation Schema Extension

Update the `DistillationSchema` in `processExecutionMemoryBacklog.ts` to accept the new memory types:

```typescript
const DistillationSchema = z.object({
  decision: z.enum(['create', 'skip']),
  skipReason: z.enum([
    'infra_only',
    'insufficient_signal',
    'already_completed',
    'no_reusable_lesson',
    'planning_unclear',        // NEW
  ]).optional(),
  evidenceSummary: z.string().min(1),
  memories: z.array(z.object({
    memoryType: z.enum([
      'implementation_pattern',
      'verification_pattern',
      'pitfall_pattern',
      'decomposition_pattern',   // NEW
      'planning_decision',       // NEW
      'review_finding',          // NEW
    ]),
    title: z.string().min(1),
    appliesWhen: z.string().min(1),
    action: z.string().min(1),
    avoid: z.string().min(1),
    verification: z.string().min(1),
    evidenceSummary: z.string().min(1),
    retrievalText: z.string().min(1),
    keywords: z.array(z.string()).default([]),
    labelHints: z.array(z.string()).default([]),
    componentHints: z.array(z.string()).default([]),
    confidence: z.number().min(0).max(1),
  })).default([]),
});
```

#### 3b. Prompt Router

Add an agent-type-based prompt builder selector in `processExecutionMemoryBacklog.ts`:

```typescript
function buildDistillationPrompt(
  task: CodeTask,
  logs: { text: string }[],
  turnMetrics: unknown[],
  issueContext: { description: string | null; comments: { body: string; createdAt: string }[] }
): string {
  switch (task.agentType) {
    case 'planning':
      return buildPlanningDistillationPrompt(task, logs, turnMetrics, issueContext);
    case 'review':
      return buildReviewDistillationPrompt(task, logs, issueContext);
    default:
      return buildExecutionDistillationPrompt(task, logs, turnMetrics, issueContext);
  }
}
```

The existing `distillTask` function calls this router instead of building the prompt inline.

#### 3c. Planning Distillation Prompt

**Version:** `planning-memory-distiller@1.0.0`

**Input signals available:**
- `task.result.planning_outcome_label` — `'planned'` (successful planning)
- `task.result.planning_is_complex` — `'0'` (SIMPLE/PLAN-DOC) or `'1'` (COMPLEX)
- `task.result.planning_subtask_urls` — comma-separated subtask URLs (for COMPLEX)
- `task.result.planning_pr_url` — planning PR URL
- `task.result.planning_superpowers_writing_plans_used` — `'0'` or `'1'`
- Task logs (planning reasoning, complexity judgment, decomposition decisions)
- Linear issue description and comments (the input the planning agent received)
- Turn metrics (cost, duration, API calls)

**Prompt structure:**

```
Version: planning-memory-distiller@1.0.0
Task status: {task.status}
Planning outcome: {task.result.planning_outcome_label}
Complexity classification: {planning_is_complex === '1' ? 'COMPLEX' : 'SIMPLE_OR_PLAN_DOC'}
Subtask count: {count of planning_subtask_urls}
Used writing-plans skill: {planning_superpowers_writing_plans_used}
Planning PR URL: {planning_pr_url}
Linear description: {issueContext.description}
Linear comments: {issueContext.comments joined}
Recent logs:
{logs joined, max 350 lines}
Turn metrics:
{JSON turnMetrics}

You are a planning memory distiller. Analyze this completed planning task and extract
reusable patterns about how issues should be planned and decomposed.

Focus on:
1. DECOMPOSITION PATTERNS: How was the issue broken into subtasks? What service boundaries
   were identified? What parallelization strategy was used? Were subtasks properly scoped
   to single services/workers?
2. PLANNING DECISIONS: What indicators led to the complexity classification? What made this
   issue SIMPLE vs COMPLEX? What signals in the Linear issue description predicted the
   outcome?
3. Any verification or pitfall patterns that emerged during planning (e.g., missing
   composite indexes, cross-service dependencies that blocked parallelization).

Memory types to use:
- "decomposition_pattern": How complex issues should be broken into subtasks
- "planning_decision": Complexity classification heuristics and indicators
- "implementation_pattern": Reusable if planning uncovered an implementation approach
- "verification_pattern": Reusable if planning identified verification requirements
- "pitfall_pattern": Reusable if planning identified risks or common mistakes

Return JSON only. {schema}
```

#### 3d. Review Distillation Prompt

**Version:** `review-memory-distiller@1.0.0`

**Input signals available:**
- `task.result.review_body` — full review summary text (NEW field)
- `task.result.review_inline_comments` — JSON array of inline comments (NEW field)
- `task.result.review_types` — which review types were performed (e.g., `code_quality security architecture`)
- `task.result.review_comments_posted` — count of comments
- `task.result.needs_remediation` — `'0'` or `'1'`
- `task.result.gh_actions_status` — CI status
- Linear issue description and comments (requirements context)
- Task logs (review reasoning)

**Prompt structure:**

```
Version: review-memory-distiller@1.0.0
Task status: {task.status}
Review types: {task.result.review_types}
Comments posted: {task.result.review_comments_posted}
Needs remediation: {task.result.needs_remediation}
CI status: {task.result.gh_actions_status}
Review body:
{task.result.review_body}
Inline comments:
{task.result.review_inline_comments}
Linear description: {issueContext.description}
Linear comments: {issueContext.comments joined}
Recent logs:
{logs joined, max 350 lines}

You are a review memory distiller. Analyze this completed code review and extract
reusable patterns that would help FUTURE EXECUTION AGENTS avoid the issues found.

Focus on:
1. REVIEW FINDINGS: What code quality, security, or architecture issues were flagged?
   Are any of these recurring patterns that other execution tasks should know about?
2. PITFALL PATTERNS: What mistakes did the implementation make that a review caught?
   These are high-value memories — they prevent future agents from making the same errors.
3. VERIFICATION PATTERNS: What checks or tests would have caught these issues before
   review? These help execution agents self-verify before submitting for review.

Memory types to use:
- "review_finding": Recurring patterns flagged by reviewers that execution agents should
  be aware of (e.g., "always add composite Firestore indexes for multi-field queries")
- "pitfall_pattern": Specific mistakes the review caught that should be avoided
- "verification_pattern": Tests or checks that would have caught the issues pre-review
- "implementation_pattern": Better approaches the review suggested

Important:
- Only extract patterns that are REUSABLE across different tasks/PRs.
- Do NOT extract one-off findings specific to a single file or function.
- A review that found no issues (needs_remediation='0') may still contain positive
  patterns worth remembering (e.g., "this approach to error handling was correct").

Return JSON only. {schema}
```

#### 3e. Existing Execution Distillation Prompt

No changes to the existing execution distillation prompt. It continues to work as-is for execution tasks. The `buildExecutionDistillationPrompt` function is a direct extraction of the current inline prompt in `distillTask`.

### 4. Evaluation Changes

The evaluation step in `evaluateApplication` currently reads execution-specific self-report fields:
- `execution_memory_ids_used`
- `execution_memory_ids_rejected`
- `execution_memory_usage_summary`

Planning and review agents don't report these fields. The evaluation needs agent-aware adaptation.

#### 4a. Evaluation Prompt Router

```typescript
function buildEvaluationContext(task: CodeTask): {
  selfReportUsed: string;
  selfReportRejected: string;
  selfReportSummary: string;
} {
  switch (task.agentType) {
    case 'planning':
      // Planning agents don't have self-report fields yet.
      // Use outcome as proxy: planned = likely used memories, unclear = likely didn't help.
      return {
        selfReportUsed: '',
        selfReportRejected: '',
        selfReportSummary: task.result?.planning_outcome_label === 'planned'
          ? 'Planning completed successfully'
          : 'Planning outcome was unclear',
      };
    case 'review':
      // Review agents don't have self-report fields.
      // Use remediation signal: needs_remediation='0' means review found no issues.
      return {
        selfReportUsed: '',
        selfReportRejected: '',
        selfReportSummary: task.result?.needs_remediation === '1'
          ? `Review found issues requiring remediation (${task.result?.review_comments_posted ?? '0'} comments)`
          : 'Review completed with no remediation needed',
      };
    default:
      return {
        selfReportUsed: task.result?.execution_memory_ids_used ?? '',
        selfReportRejected: task.result?.execution_memory_ids_rejected ?? '',
        selfReportSummary: task.result?.execution_memory_usage_summary ?? '',
      };
  }
}
```

The evaluation prompt template stays the same — it already handles missing self-report fields gracefully. The evaluator LLM assesses memory usefulness from logs + the context provided.

#### 4b. Future: Agent Self-Report Fields

In a future iteration, planning and review orchestrator prompts can instruct agents to report which memories they used/rejected, matching the execution agent pattern. This is not required for v1 — the LLM evaluator can infer usage from logs.

### 5. System Prompt Rendering

#### 5a. Current State

`buildExecutionMemorySection()` in `workers/orchestrator/src/services/system-prompt.ts` (line 80) renders matched memories into a prompt section. It's currently only called from the execution agent prompt builder (line 350).

#### 5b. Changes

Add the same call to:
- **Planning agent prompt section** — after the Linear issue context, before the complexity classification instruction
- **Review agent prompt section** — after the review types list, before the mandatory first action

The rendered section is identical across all agents. The memories are labeled "advisory, not authoritative" and the agent is told to trust current state over memory. No agent-specific rendering needed.

### 6. Orchestrator Review Content Capture

#### 6a. Current Review Flow

The orchestrator's review agent builds the full review body and inline comments, posts them to GitHub via the `POST /reviews` API, then reports back via webhook with `review_id`, `review_comments_posted`, `review_types`, and `needs_remediation`.

#### 6b. Changes

Before posting the review to GitHub, the orchestrator captures the review body and inline comments and includes them in the webhook result:

```typescript
// In the review agent's completion handler (orchestrator)
result.review_body = reviewBody;                              // Full summary text
result.review_inline_comments = JSON.stringify(inlineComments); // [{path, line, body}]
```

This is the orchestrator's `REVIEW_AGENT_FINAL` block parser — it already extracts structured data from the agent's output. We add two more fields to the extraction.

**Size consideration:** Review bodies are typically 500-2000 chars, inline comments 50-300 chars each with typically 3-10 comments. Total payload increase is ~2-5KB — well within webhook limits.

### 7. Retrieval — No Changes Required

The retrieval logic in `prepareExecutionMemoryContext.ts` is already agent-agnostic:
- Vector search queries the `execution_memories` collection by embedding similarity
- Reranking uses `componentOverlap`, `labelOverlap`, and `effectiveness` — none are agent-specific
- The MIN_RERANK_SCORE (0.68) and MAX_MATCHES (3) apply universally

New memory types (`decomposition_pattern`, `planning_decision`, `review_finding`) are stored with the same embedding, fingerprint, and metadata structure. They participate in vector search and reranking identically.

**Future optimization (not in scope):** Agent-type-aware reranking could boost relevant memory types per agent (e.g., boost `decomposition_pattern` for planning agents, boost `review_finding` for execution agents). This would be a reranking formula change, not an architecture change.

### 8. Fingerprint and Deduplication

The existing fingerprint function (`buildFingerprint`) uses `repository + memoryType + title + appliesWhen + action + avoid`. The new memory types participate in this naturally — no changes needed. The `memoryType` field in the fingerprint ensures that a `review_finding` and an `implementation_pattern` with similar content are treated as distinct memories.

Near-duplicate detection (vector score >= 0.94 with same `memoryType`) also works unchanged.

## Endpoint Changes

### Modified
- `POST /internal/webhooks/task-complete` — accepts new `review_body` and `review_inline_comments` result fields; post-run queueing gate widened to planning and review agents
- `POST /internal/process-execution-memory-backlog` — processes planning and review tasks in addition to execution tasks

### Created
None.

### Removed
None.

### Unchanged
- `POST /internal/drain-queue` — already dispatches all agent types; memory retrieval gate widened internally
- All other endpoints

## Testing Strategy

### Unit Tests

1. **`isMemoryEligibleAgent` utility** — test all agent types including edge cases (`undefined`, `'remediation'`, `'pull_request'`)
2. **`shouldSkipDistillation`** — test execution `already_completed`, planning `unclear`, and pass-through cases
3. **`buildDistillationPrompt` router** — verify correct prompt builder is selected per agent type
4. **Planning distillation prompt builder** — verify all planning result fields are included
5. **Review distillation prompt builder** — verify `review_body` and `review_inline_comments` are included
6. **`buildEvaluationContext`** — verify agent-specific context extraction for all three types
7. **`DistillationSchema` validation** — verify new memory types are accepted
8. **Existing tests** — all existing execution memory tests must continue to pass unchanged (the execution path is not modified, only extended)

### Integration Tests

1. **drainTaskQueue** — verify memory retrieval runs for planning and review tasks when `executionMemoryEnabled=true`
2. **drainRetryQueue** — same as above for retry path
3. **webhookRoutes** — verify post-run queueing for planning and review task completions
4. **processExecutionMemoryBacklog** — verify end-to-end distillation for planning and review tasks

### What NOT to Test

- The orchestrator prompt rendering is tested via the orchestrator's own test suite. We only need to verify the `buildExecutionMemorySection` call is present in the new prompt sections — not re-test the rendering logic.
- Review content capture in the orchestrator is a straightforward field addition to the webhook payload — covered by orchestrator's existing webhook test patterns.

## Rollout

The existing `INTEXURAOS_EXECUTION_MEMORY_ENABLED` feature flag gates the entire memory system. No new env vars needed — when memory is enabled, it's enabled for all eligible agents.

If gradual rollout per agent type is desired later, the `MEMORY_ELIGIBLE_AGENTS` set can be driven by an env var. Not needed for v1.

## Risks and Mitigations

| Risk                                                                                   | Mitigation                                                                                                                                |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Review memories may be lower quality (no "did it help?" outcome signal)                | Use remediation outcome as proxy in evaluation; suppress memories with low quality scores as today                                        |
| Planning agents produce fewer tasks than execution agents → slower memory accumulation | Acceptable — planning patterns are higher-signal and change less frequently                                                               |
| Increased distillation token cost (3 agent types instead of 1)                         | Planning and review distillation prompts are similar size to execution; cost scales linearly with task count, not agent type count        |
| New memory types could dilute retrieval quality for execution agents                   | Vector search + reranking naturally filters by semantic relevance; irrelevant memories from other agents won't score above 0.68 threshold |
