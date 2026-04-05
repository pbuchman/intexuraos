# Enforce PR Evidence for All Non-Planning Task Types

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every non-planning agent type produces a PR as evidence of work, including no-op PRs when no code changes are natural (e.g., debugging/investigation tasks routed to the planning agent).

**Architecture:** The planning agent system prompt currently allows SIMPLE tasks to complete without a PR, and debugging tasks routed as "planning" produce no structured output at all. This plan adds: (1) a "no-op evidence PR" requirement to the planning agent prompt for non-plan tasks (debugging), (2) strengthens the completion verifier to validate PR presence for non-planning outcomes, and (3) adds enforcement in code-agent webhook handler.

**Tech Stack:** TypeScript, Zod schemas, Fastify webhook routes, Vitest

---

## Problem Analysis

### Current State

1. **Planning agent** (`system-prompt.ts` `planningPrompt` v5.1.0):
   - SIMPLE tasks: no PR required ("Edit the issue description only. No subtasks, no plan doc, no PR.")
   - PLAN-DOC/COMPLEX tasks: PR required
   - Debugging tasks: routed as `planning` agent type, but the prompt says "NO IMPLEMENTATION CODING IS ALLOWED" — debugging falls through cracks, produces `unclear` with no structured artifacts

2. **Completion verifier** (`completion-verifier.ts`):
   - `PLANNING_SCHEMA`: `pr_url` is `z.string()` — accepts empty string, no validation that non-simple tasks have a PR
   - No semantic validation: verifier only checks field presence, not business rules

3. **Code-agent webhook** (`webhookRoutes.ts`):
   - `enforcePlanningOutcome()`: validates Linear issue state transitions but does NOT check for PR presence
   - Execution enforcement already requires `result.prUrl` (line 647-652)
   - Pull request enforcement already requires `result.prUrl` (line 759-763)

### Gap Summary

| Agent Type                  | PR Required Today?              | Gap                                          |
| --------------------------- | ------------------------------- | -------------------------------------------- |
| execution                   | Yes (enforced at lines 647-652) | None                                         |
| pull_request                | Yes (enforced at lines 759-763) | None                                         |
| remediation                 | Has PR from existing branch     | No enforcement check                         |
| review                      | Read-only, no PR needed         | None (correct)                               |
| planning (PLAN-DOC/COMPLEX) | Yes (prompt says "ALWAYS")      | No enforcement in webhook                    |
| planning (SIMPLE)           | No                              | **Gap**: should create evidence PR           |
| planning (debugging)        | No                              | **Gap**: falls through, no structured output |

### Design Decisions

1. **All planning outcomes with `outcome=planned` MUST include a PR URL** — even SIMPLE tasks. The agent creates a no-op evidence PR (e.g., adding a timestamp comment to a plan doc or creating an empty plan stub).
2. **Debugging tasks routed to planning agent** should NOT be handled as planning — they should exit with `unclear` AND a structured investigation summary. However, the real fix is ensuring the task dispatcher routes debugging to the correct agent type. For now, the planning prompt should handle debugging gracefully with structured output.
3. **Remediation agent** should also enforce PR presence since it pushes code changes.
4. **The verifier prompt** should instruct Gemini to flag missing PRs as a verification concern.

---

## File Structure

| File                                                                      | Action | Responsibility                                                                                   |
| ------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------ |
| `workers/orchestrator/src/services/system-prompt.ts`                      | Modify | Update planning prompt: require evidence PR for SIMPLE tasks, add debugging handling guidance    |
| `workers/orchestrator/src/services/completion-verifier.ts`                | Modify | Add `pr_url` non-empty validation for `planned` outcome; add remediation `gh_pr_url` enforcement |
| `apps/code-agent/src/routes/webhookRoutes.ts`                             | Modify | Add PR presence enforcement for `planning (planned)` and `remediation` outcomes                  |
| `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts` | Modify | Test new validation rules                                                                        |
| `apps/code-agent/src/__tests__/routes/webhooks.test.ts`                   | Modify | Test new enforcement checks                                                                      |
| `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`       | Modify | Verify prompt content includes new requirements                                                  |

---

### Task 1: Update Planning Agent System Prompt — Evidence PR Requirement

**Files:**
- Modify: `workers/orchestrator/src/services/system-prompt.ts` (lines 206-292 in `planningPrompt.build()`)
- Test: `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`

The planning prompt currently says SIMPLE tasks have "No subtasks, no plan doc, no PR." This must change.

- [ ] **Step 1: Write the failing test**

Add a test that verifies the planning prompt contains evidence PR requirements for SIMPLE tasks:

```typescript
it('planning prompt requires evidence PR for SIMPLE tasks', () => {
  const prompt = planningPrompt.build(defaultParams);
  expect(prompt).toContain('evidence PR');
  expect(prompt).not.toContain('No subtasks, no plan doc, no PR');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter orchestrator test -- --run system-prompt.test.ts`
Expected: FAIL — prompt still contains old text

- [ ] **Step 3: Update the SIMPLE task description in the planning prompt**

In `system-prompt.ts`, find the `planningPrompt` builder, locate the SIMPLE task section (around line 208):

**Replace:**
```
**SIMPLE task:** Edit the issue description only. No subtasks, no plan doc, no PR.
A task is SIMPLE only when the implementation is a single mechanical change (1-2 files, no design decisions, no multi-step sequence).
```

**With:**
```
**SIMPLE task:** Edit the issue description only. No subtasks, no plan doc.
A task is SIMPLE only when the implementation is a single mechanical change (1-2 files, no design decisions, no multi-step sequence).
**Evidence PR (MANDATORY for ALL planned outcomes including SIMPLE):**
Even SIMPLE tasks MUST create an evidence PR. Create a branch \`plan/<short-slug>\`, add a file \`docs/plans/<INT-XXX>-evidence.md\` containing the task summary and timestamp, commit it, and open a PR. This PR serves as auditable evidence that work was performed. The PR title format is the same: \`[INT-XXX] [plan] title\`.
```

Also update the completion criteria block to remove the exception:

**Replace:**
```
- Plan PR: <full GitHub PR URL or empty — NEVER for SIMPLE tasks, ALWAYS for PLAN-DOC and COMPLEX tasks>
```

**With:**
```
- Plan PR: <full GitHub PR URL — MANDATORY for ALL planned outcomes, including SIMPLE tasks>
```

- [ ] **Step 4: Add debugging task handling guidance to the planning prompt**

After the "Code Task Debugging" section in `WORKER_INSTRUCTIONS`, the planning prompt should include guidance for when a debugging/investigation task is routed to it. Add after the Complexity Judgment section:

```
### Debugging/Investigation Tasks (routed as planning)

If the Linear issue describes debugging, investigation, or diagnosis of a production issue:
1. Perform the investigation using available tools (logs, code, Firestore).
2. Document findings in a plan document: \`docs/plans/<INT-XXX>-investigation.md\`.
3. Update the Linear issue description with findings and recommendations.
4. Create an evidence PR with the investigation document.
5. Report outcome as \`planned\` with the PR URL — debugging produces documentation artifacts.

Do NOT report \`unclear\` for debugging tasks unless the issue description itself is ambiguous about WHAT to debug.
```

- [ ] **Step 5: Bump the prompt version**

Change `version: '5.1.0'` to `version: '6.0.0'` (major bump — behavior change: SIMPLE tasks now require PR).

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter orchestrator test -- --run system-prompt.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add workers/orchestrator/src/services/system-prompt.ts workers/orchestrator/src/services/__tests__/system-prompt.test.ts
git commit -m "feat(orchestrator): require evidence PR for all planned outcomes including SIMPLE tasks

Bump planningPrompt to v6.0.0. SIMPLE tasks now must create an evidence PR.
Adds debugging/investigation task handling guidance."
```

---

### Task 2: Strengthen Completion Verifier — PR Presence Validation

**Files:**
- Modify: `workers/orchestrator/src/services/completion-verifier.ts` (lines 111-168, 213-237)
- Test: `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts` (or `deep-validator-helpers.test.ts`)

Currently `PLANNING_SCHEMA` accepts empty `pr_url` for any outcome. The verifier prompt also doesn't instruct Gemini to flag missing PRs.

- [ ] **Step 1: Write failing tests for planning schema PR validation**

```typescript
describe('PLANNING_SCHEMA pr_url validation', () => {
  it('rejects empty pr_url when outcome is planned', () => {
    const result = PLANNING_SCHEMA.safeParse({
      outcome: 'planned',
      superpowers_writing_plans: 'used',
      linear_url: 'https://linear.app/pbuchman/issue/INT-100/test',
      is_complex: '0',
      has_plan_doc: '0',
      subtask_urls: '',
      pr_url: '',  // <-- should fail for planned outcome
      summary: 'test',
      unclear_clarification: '',
    });
    expect(result.success).toBe(false);
  });

  it('allows empty pr_url when outcome is unclear', () => {
    const result = PLANNING_SCHEMA.safeParse({
      outcome: 'unclear',
      superpowers_writing_plans: 'used',
      linear_url: 'https://linear.app/pbuchman/issue/INT-100/test',
      is_complex: '0',
      has_plan_doc: '0',
      subtask_urls: '',
      pr_url: '',
      summary: 'test',
      unclear_clarification: 'Not enough info',
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter orchestrator test -- --run completion-verifier`
Expected: first test FAILS (schema currently accepts empty pr_url)

- [ ] **Step 3: Add Zod refinement to PLANNING_SCHEMA**

Replace the current `PLANNING_SCHEMA`:

```typescript
export const PLANNING_SCHEMA = z.object({
  outcome: z.enum(['planned', 'unclear']),
  superpowers_writing_plans: z.enum(['used', 'not used']),
  linear_url: z.string(),
  is_complex: z.enum(['0', '1']),
  has_plan_doc: z.enum(['0', '1']),
  subtask_urls: z.string(),
  pr_url: z.string(),
  summary: z.string(),
  unclear_clarification: z.string(),
}).refine(
  (data) => data.outcome !== 'planned' || data.pr_url !== '',
  {
    message: 'pr_url is required when outcome is "planned"',
    path: ['pr_url'],
  }
);
```

- [ ] **Step 4: Add similar refinement to REMEDIATION_SCHEMA**

The remediation schema already has `gh_pr_url` as `z.string()`. Add a refinement:

```typescript
export const REMEDIATION_SCHEMA = z.object({
  outcome: z.enum(['implemented', 'already_completed']),
  gh_pr_url: z.string(),
  requires_re_review: z.string().regex(/^[01]$/, 'requires_re_review must be "0" or "1"'),
  summary: z.string(),
}).refine(
  (data) => data.outcome !== 'implemented' || data.gh_pr_url !== '',
  {
    message: 'gh_pr_url is required when outcome is "implemented"',
    path: ['gh_pr_url'],
  }
);
```

- [ ] **Step 5: Update the verifier prompts to instruct Gemini about PR requirements**

In `buildPlanningPrompt()`, add to the Fields section after the `pr_url` field description:

```
'- pr_url: the GitHub Pull Request URL — REQUIRED for "planned" outcome (ALL planned tasks must produce a PR, including simple ones). Empty string ONLY for "unclear" outcome.',
```

In `buildRemediationPrompt()`, update the `gh_pr_url` field description:

```
'- gh_pr_url: the GitHub Pull Request URL — REQUIRED for "implemented" outcome. Empty string ONLY for "already_completed" outcome.',
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter orchestrator test -- --run completion-verifier`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add workers/orchestrator/src/services/completion-verifier.ts workers/orchestrator/src/services/__tests__/completion-verifier.test.ts
git commit -m "feat(orchestrator): enforce PR URL presence in completion verifier schemas

PLANNING_SCHEMA now rejects empty pr_url for planned outcome.
REMEDIATION_SCHEMA now rejects empty gh_pr_url for implemented outcome.
Verifier prompts updated to instruct Gemini about mandatory PR fields."
```

---

### Task 3: Add PR Enforcement in Code-Agent Webhook Handler

**Files:**
- Modify: `apps/code-agent/src/routes/webhookRoutes.ts` (inside `enforcePlanningOutcome` function and remediation handling)
- Test: `apps/code-agent/src/__tests__/routes/webhooks.test.ts`

Currently `enforcePlanningOutcome()` validates Linear issue state but does not check for PR presence. Execution and pull_request agents already enforce this.

- [ ] **Step 1: Write failing test for planning PR enforcement**

```typescript
it('rejects planned outcome without PR URL', async () => {
  // Set up a planning task that completes with outcome=planned but no prUrl and no planning_pr_url
  const response = await app.inject({
    method: 'POST',
    url: '/internal/webhooks/task-complete',
    payload: {
      taskId: planningTaskId,
      status: 'completed',
      result: {
        planning_outcome_label: 'planned',
        planning_is_complex: '0',
        planning_linear_url: 'https://linear.app/pbuchman/issue/INT-100/test',
        // No planning_pr_url, no prUrl
        summary: 'Planned a simple task',
      },
    },
  });

  const body = JSON.parse(response.body);
  // Should fail enforcement
  const task = await codeTaskRepo.findById(planningTaskId);
  expect(task.ok && task.value.status).toBe('failed');
  expect(task.ok && task.value.error?.code).toBe('PLANNING_AGENT_ENFORCEMENT_FAILED');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter code-agent test -- --run webhooks.test.ts`
Expected: FAIL — currently no PR enforcement for planning

- [ ] **Step 3: Add PR enforcement to `enforcePlanningOutcome()`**

In `webhookRoutes.ts`, inside the `enforcePlanningOutcome` function, add a check at the top (after the `linearIssueId` check, around line 366):

```typescript
if (outcome === 'planned') {
  const prUrl = planningResult.planning_pr_url ?? planningResult.prUrl;
  if (!prUrl) {
    return {
      ok: false,
      message: 'Planning enforcement requires a PR URL for planned outcomes — all planned tasks must produce an evidence PR',
    };
  }
}
```

- [ ] **Step 4: Add PR enforcement for remediation (implemented outcome)**

Find the remediation handling section (after `task.agentType === 'review'` block). Add enforcement:

```typescript
if (task.agentType === 'remediation') {
  if (result === undefined) {
    // ... existing missing result handling ...
  }
  if (result.execution_outcome_label === 'implemented' && !result.prUrl) {
    // Remediation with implemented outcome but no PR
    const failResult = await codeTaskRepo.update(taskId, {
      status: 'failed',
      completedAt,
      result,
      error: {
        code: 'REMEDIATION_AGENT_ENFORCEMENT_FAILED',
        message: 'Remediation enforcement requires result.prUrl for implemented outcome',
      },
      callbackReceived: true,
    });
    // ... return ...
  }
}
```

Note: Check if remediation handling already exists in the webhook. Read the full remediation section first. The remediation agent's outcome field maps to `execution_outcome_label` in the result (see `buildResultFromVerification` line 1338).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter code-agent test -- --run webhooks.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/code-agent/src/routes/webhookRoutes.ts apps/code-agent/src/__tests__/routes/webhooks.test.ts
git commit -m "feat(code-agent): enforce PR presence for planning and remediation outcomes

enforcePlanningOutcome() now rejects planned outcomes without a PR URL.
Adds remediation enforcement for implemented outcomes without PR."
```

---

### Task 4: Run Full CI and Verify

- [ ] **Step 1: Build all packages**

Run: `pnpm build`
Expected: All packages build successfully

- [ ] **Step 2: Run workspace verification for orchestrator**

Run: `pnpm run verify:workspace:tracked -- orchestrator`
Expected: PASS with 100% coverage

- [ ] **Step 3: Run workspace verification for code-agent**

Run: `pnpm run verify:workspace:tracked -- code-agent`
Expected: PASS with 100% coverage

- [ ] **Step 4: Run full CI**

Run: `pnpm run ci:tracked`
Expected: All checks pass

- [ ] **Step 5: Commit any remaining fixes**

If CI reveals issues, fix them and commit.

---

## Summary of Changes

| Change                                                  | Location                 | Impact                                                        |
| ------------------------------------------------------- | ------------------------ | ------------------------------------------------------------- |
| Planning prompt v6.0.0: evidence PR required for SIMPLE | `system-prompt.ts`       | All planned outcomes must produce a PR                        |
| Planning prompt: debugging task guidance                | `system-prompt.ts`       | Debugging routed as planning produces investigation docs + PR |
| PLANNING_SCHEMA Zod refinement                          | `completion-verifier.ts` | Verifier rejects planned outcomes without pr_url              |
| REMEDIATION_SCHEMA Zod refinement                       | `completion-verifier.ts` | Verifier rejects implemented outcomes without gh_pr_url       |
| Verifier prompts updated                                | `completion-verifier.ts` | Gemini instructed about mandatory PR fields                   |
| enforcePlanningOutcome PR check                         | `webhookRoutes.ts`       | Deterministic enforcement rejects PR-less planned outcomes    |
| Remediation enforcement                                 | `webhookRoutes.ts`       | Deterministic enforcement rejects PR-less remediation         |

## Endpoint Changes

- **Modified:** `POST /internal/webhooks/task-complete` — adds PR enforcement for planning (planned) and remediation (implemented) outcomes
- **Created:** None
- **Removed:** None
- **Unchanged:** All other endpoints
