# Execution Task Mandatory PR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce that every execution task produces a pull request — even when no code changes are needed (`already_completed` outcome) — mirroring the existing pattern used by planning tasks.

**Architecture:** Three coordinated changes within the orchestrator worker: (1) add a Zod `.refine()` to `EXECUTION_SCHEMA` requiring non-empty `gh_pr_url` for all outcomes, (2) update `buildExecutionPrompt` so Gemini knows to require the PR URL, (3) update the execution system prompt to instruct the agent to create an evidence PR for `already_completed` outcomes and bump the prompt version. All changes are in `workers/orchestrator/`.

**Tech Stack:** TypeScript, Zod, Vitest

---

## Current State Analysis

### How planning tasks enforce PRs today
- **PLANNING_SCHEMA** (`completion-verifier.ts:111-127`) has a `.refine()` that rejects empty `pr_url` when `outcome === 'planned'`.
- The planning system prompt (`system-prompt.ts:210-211`) says: "Even SIMPLE tasks MUST create an evidence PR."
- The `buildPlanningPrompt()` Gemini extraction prompt explicitly states: `"pr_url: the GitHub Pull Request URL — REQUIRED for 'planned' outcome"`.

### How execution tasks handle PRs today (the gap)
- **EXECUTION_SCHEMA** (`completion-verifier.ts:129-138`) has NO `.refine()` — it accepts empty `gh_pr_url` for any outcome.
- The execution system prompt (`system-prompt.ts:415-425`) says: for `already_completed`, `"Set PR to 'N/A'"`.
- The `buildExecutionPrompt()` Gemini extraction prompt (`completion-verifier.ts:262`) says: `"gh_pr_url: the GitHub Pull Request URL (string, empty string if not found)"` — no requirement.
- The example for `already_completed` in `buildExecutionPrompt()` (`completion-verifier.ts:270`) shows `"gh_pr_url":""` — empty string.

### How remediation tasks enforce PRs (same pattern to replicate)
- **REMEDIATION_SCHEMA** (`completion-verifier.ts:169-180`) has `.refine()` requiring `gh_pr_url` when `outcome === 'implemented'` (but allows empty for `already_completed`).

### The target state
Every execution task outcome (`implemented` OR `already_completed`) must produce a non-empty `gh_pr_url`. For `already_completed`, the agent creates an evidence PR with a file like `docs/evidence/<INT-XXX>-no-changes.md`.

---

## File Structure

| File                                                                      | Action   | Responsibility                                                                                   |
| ------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `workers/orchestrator/src/services/completion-verifier.ts`                | Modify   | Add `.refine()` to `EXECUTION_SCHEMA`, update `buildExecutionPrompt()`                           |
| `workers/orchestrator/src/services/system-prompt.ts`                      | Modify   | Update execution prompt `already_completed` section, `EXECUTION_AGENT_FINAL` block, bump version |
| `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts` | Modify   | Add tests for new refinement, update prompt builder test                                         |
| `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`       | Modify   | Update version test and `already_completed` assertions                                           |

---

### Task 1: Add Zod refinement to EXECUTION_SCHEMA

**Files:**
- Modify: `workers/orchestrator/src/services/completion-verifier.ts:129-138`
- Test: `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts:221-248`

- [ ] **Step 1: Write the failing tests**

Add three new test cases to the `EXECUTION_SCHEMA` describe block in `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts`, after the existing `'rejects invalid enum value'` test (line 247):

```typescript
  it('rejects empty gh_pr_url when outcome is implemented', () => {
    const result = EXECUTION_SCHEMA.safeParse({
      outcome: 'implemented',
      superpowers_subagent_driven_dev: 'used',
      superpowers_requesting_code_review: 'used',
      gh_pr_url: '',
      memory_ids_used: '',
      memory_ids_rejected: '',
      memory_usage_summary: '',
      summary: 'test',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty gh_pr_url when outcome is already_completed', () => {
    const result = EXECUTION_SCHEMA.safeParse({
      outcome: 'already_completed',
      superpowers_subagent_driven_dev: 'used',
      superpowers_requesting_code_review: 'not used',
      gh_pr_url: '',
      memory_ids_used: '',
      memory_ids_rejected: '',
      memory_usage_summary: '',
      summary: 'test',
    });
    expect(result.success).toBe(false);
  });

  it('accepts non-empty gh_pr_url when outcome is already_completed', () => {
    const result = EXECUTION_SCHEMA.safeParse({
      outcome: 'already_completed',
      superpowers_subagent_driven_dev: 'used',
      superpowers_requesting_code_review: 'not used',
      gh_pr_url: 'https://github.com/pbuchman/intexuraos/pull/999',
      memory_ids_used: '',
      memory_ids_rejected: '',
      memory_usage_summary: '',
      summary: 'Evidence PR for already-completed work.',
    });
    expect(result.success).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /repo && pnpm --filter orchestrator exec vitest run src/services/__tests__/completion-verifier.test.ts`
Expected: The first two new tests FAIL (empty `gh_pr_url` currently accepted by the schema), the third passes.

- [ ] **Step 3: Add the `.refine()` to EXECUTION_SCHEMA**

In `workers/orchestrator/src/services/completion-verifier.ts`, change the `EXECUTION_SCHEMA` (lines 129-138) from:

```typescript
export const EXECUTION_SCHEMA = z.object({
  outcome: z.enum(['implemented', 'already_completed']),
  superpowers_subagent_driven_dev: z.enum(['used', 'not used']),
  superpowers_requesting_code_review: z.enum(['used', 'not used']),
  gh_pr_url: z.string(),
  memory_ids_used: z.string(),
  memory_ids_rejected: z.string(),
  memory_usage_summary: z.string(),
  summary: z.string(),
});
```

to:

```typescript
export const EXECUTION_SCHEMA = z.object({
  outcome: z.enum(['implemented', 'already_completed']),
  superpowers_subagent_driven_dev: z.enum(['used', 'not used']),
  superpowers_requesting_code_review: z.enum(['used', 'not used']),
  gh_pr_url: z.string(),
  memory_ids_used: z.string(),
  memory_ids_rejected: z.string(),
  memory_usage_summary: z.string(),
  summary: z.string(),
}).refine(
  (data) => data.gh_pr_url !== '',
  {
    message: 'gh_pr_url is required for all execution outcomes',
    path: ['gh_pr_url'],
  }
);
```

Note: Unlike planning (which only requires PR for `planned`, not `unclear`) and remediation (which only requires PR for `implemented`, not `already_completed`), execution ALWAYS requires a PR regardless of outcome. This is intentional per the task requirements.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /repo && pnpm --filter orchestrator exec vitest run src/services/__tests__/completion-verifier.test.ts`
Expected: ALL tests pass including the three new ones.

- [ ] **Step 5: Commit**

```bash
git add workers/orchestrator/src/services/completion-verifier.ts workers/orchestrator/src/services/__tests__/completion-verifier.test.ts
git commit -m "feat(orchestrator): enforce gh_pr_url for all execution outcomes"
```

---

### Task 2: Update buildExecutionPrompt for Gemini extraction

**Files:**
- Modify: `workers/orchestrator/src/services/completion-verifier.ts:251-275`
- Test: `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts:525-544`

- [ ] **Step 1: Write the failing test**

Add a new test in the `buildExecutionPrompt` describe block in `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts`, after the existing `'includes shared preamble instructions'` test (line 544):

```typescript
  it('marks gh_pr_url as REQUIRED for all outcomes', () => {
    const prompt = buildExecutionPrompt('exec-log');
    expect(prompt).toContain('REQUIRED for all execution outcomes');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /repo && pnpm --filter orchestrator exec vitest run src/services/__tests__/completion-verifier.test.ts -t "marks gh_pr_url as REQUIRED"`
Expected: FAIL — current prompt says `"empty string if not found"`.

- [ ] **Step 3: Update buildExecutionPrompt**

In `workers/orchestrator/src/services/completion-verifier.ts`, update the `buildExecutionPrompt` function (lines 251-275). Make these specific changes:

Change line 262 from:
```
'- gh_pr_url: the GitHub Pull Request URL (string, empty string if not found)',
```
to:
```
'- gh_pr_url: the GitHub Pull Request URL — REQUIRED for all execution outcomes (including already_completed). Must not be empty.',
```

Change the `already_completed` example (line 270) from:
```
'{"outcome":"already_completed","superpowers_subagent_driven_dev":"used","superpowers_requesting_code_review":"not used","gh_pr_url":"","memory_ids_used":"","memory_ids_rejected":"mem_188","memory_usage_summary":"Rejected the supplied memory because the codebase already matched the current repo state.","summary":"* Discovered the requested work was already implemented and merged into development\\n* Verified all tests pass and the feature is present in the codebase\\n* No PR was needed"}',
```
to:
```
'{"outcome":"already_completed","superpowers_subagent_driven_dev":"used","superpowers_requesting_code_review":"not used","gh_pr_url":"https://github.com/pbuchman/intexuraos/pull/950","memory_ids_used":"","memory_ids_rejected":"mem_188","memory_usage_summary":"Rejected the supplied memory because the codebase already matched the current repo state.","summary":"* Discovered the requested work was already implemented and merged into development\\n* Verified all tests pass and the feature is present in the codebase\\n* Created evidence PR documenting completion"}',
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /repo && pnpm --filter orchestrator exec vitest run src/services/__tests__/completion-verifier.test.ts`
Expected: ALL tests pass.

- [ ] **Step 5: Commit**

```bash
git add workers/orchestrator/src/services/completion-verifier.ts workers/orchestrator/src/services/__tests__/completion-verifier.test.ts
git commit -m "feat(orchestrator): update Gemini extraction prompt to require execution PR"
```

---

### Task 3: Update execution system prompt to require evidence PRs

**Files:**
- Modify: `workers/orchestrator/src/services/system-prompt.ts:309-455`
- Test: `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`

- [ ] **Step 1: Write the failing tests**

In `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`, add/update tests:

a) Update the version test (find the test at approximately line 1258-1259):
```typescript
  it('execution prompt version is 9.0.0', () => {
    expect(executionPrompt.version).toBe('9.0.0');
  });
```

b) Add a new test for the evidence PR requirement:
```typescript
  it('execution prompt requires evidence PR for already_completed', () => {
    const result = buildSystemPrompt({ ...baseParams, linearIssueLabels: ['code-task'] });

    expect(result).toContain('Evidence PR (MANDATORY for already_completed)');
    expect(result).toContain('docs/evidence/');
    expect(result).not.toContain('Set PR to "N/A"');
  });
```

c) Update the existing test that checks for `already_completed` outcome format (approximately line 492):
```typescript
  it('builds execution agent prompt with execution marker and final block', () => {
    const result = buildSystemPrompt({ ...baseParams, linearIssueLabels: ['code-task'] });

    // ... existing assertions ...
    expect(result).toContain('- Outcome: <implemented|already_completed>');
    expect(result).toContain('- PR: <full GitHub PR URL>');
    expect(result).not.toContain('"N/A"');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /repo && pnpm --filter orchestrator exec vitest run src/services/__tests__/system-prompt.test.ts`
Expected: FAIL — current prompt has version `8.1.0`, contains `"N/A"`, and lacks evidence PR instructions.

- [ ] **Step 3: Update the execution prompt**

In `workers/orchestrator/src/services/system-prompt.ts`, make these changes to the `executionPrompt`:

**3a. Bump version** (line 312):
Change `version: '8.1.0'` to `version: '9.0.0'` (major bump — behavior change: PR now mandatory for all outcomes).

**3b. Replace the Already-Completed Detection section** (lines 415-425).

Change from:
```
### Already-Completed Detection
If you discover that the requested work has ALREADY been implemented and
merged into the base branch (feature exists, tests pass, code is present):
1. Verify the work is genuinely complete (not partially done)
2. Report Outcome: already_completed in EXECUTION_AGENT_FINAL
3. Set PR to "N/A"
4. Provide a Summary explaining what you found
5. You may skip superpowers:requesting-code-review

Do NOT use already_completed if: you failed to create a PR for other
reasons, the work is partially done, or you gave up.
```

To:
```
### Already-Completed Detection
If you discover that the requested work has ALREADY been implemented and
merged into the base branch (feature exists, tests pass, code is present):
1. Verify the work is genuinely complete (not partially done)
2. Report Outcome: already_completed in EXECUTION_AGENT_FINAL
3. You may skip superpowers:requesting-code-review
4. Provide a Summary explaining what you found

**Evidence PR (MANDATORY for already_completed):**
Even when no code changes are needed, you MUST create a PR as auditable evidence.
1. Create a branch from development (e.g., \`evidence/<short-slug>\`)
2. Add a file \`docs/evidence/<INT-XXX>-no-changes.md\` with:
   - The Linear issue ID and title
   - A brief explanation of why no changes were needed
   - Timestamp
3. Commit and open a PR targeting development
4. Return the PR URL in EXECUTION_AGENT_FINAL

Do NOT use already_completed if: you failed to create a PR for other
reasons, the work is partially done, or you gave up.
```

**3c. Update the EXECUTION_AGENT_FINAL block** (lines 436-451).

Change line 438 from:
```
- PR: <full GitHub PR URL, or "N/A" if already_completed>
```
to:
```
- PR: <full GitHub PR URL>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /repo && pnpm --filter orchestrator exec vitest run src/services/__tests__/system-prompt.test.ts`
Expected: ALL tests pass.

- [ ] **Step 5: Commit**

```bash
git add workers/orchestrator/src/services/system-prompt.ts workers/orchestrator/src/services/__tests__/system-prompt.test.ts
git commit -m "feat(orchestrator): require evidence PR for all execution outcomes"
```

---

### Task 4: Run full CI and verify

- [ ] **Step 1: Build packages**

Run: `cd /repo && pnpm build`
Expected: Clean build, no errors.

- [ ] **Step 2: Run workspace verification**

Run: `cd /repo && pnpm run verify:workspace:tracked -- orchestrator`
Expected: All tests pass, coverage meets thresholds.

- [ ] **Step 3: Run full CI**

Run: `cd /repo && pnpm run ci:tracked`
Expected: All workspaces pass.

- [ ] **Step 4: Final commit if any CI fixes needed**

If CI exposed issues, fix and commit with a descriptive message.

---

## Endpoint Changes

- Modified: None
- Created: None
- Removed: None
- Unchanged: All existing endpoints

## Key Design Decisions

1. **PR required for ALL execution outcomes, not just `implemented`**: Unlike planning (which allows empty PR for `unclear`) and remediation (which allows empty PR for `already_completed`), execution enforces PR for every outcome. This is the explicit requirement from the issue.

2. **Evidence file pattern**: Uses `docs/evidence/<INT-XXX>-no-changes.md` (not `docs/plans/`) to distinguish evidence-only PRs from planning artifacts. This avoids polluting the plans directory.

3. **Version bump to 9.0.0**: This is a major behavioral change — agents that previously reported `already_completed` with no PR will now fail validation. The major bump signals this breaking contract change.

4. **No changes to task-dispatcher.ts**: The `buildResultFromVerification` method already handles non-empty `gh_pr_url` correctly (line 1313-1314: `if (agentData.gh_pr_url !== '') { base.prUrl = agentData.gh_pr_url; }`). Since `gh_pr_url` will now always be non-empty, `prUrl` will always be set — no code change needed.

5. **No changes to submitToExecutionAgent.ts**: The planning-to-execution flow reads `planning_pr_url` from the planning task result, which is unaffected by execution-side changes.
