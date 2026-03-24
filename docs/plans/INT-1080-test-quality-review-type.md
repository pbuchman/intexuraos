# Test Quality Review Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `test_quality` review type that specializes in reviewing TypeScript test code for false positives, testing granularity, and v8 ignore comment legitimacy.

**Architecture:** Extend the existing review type system (`ALL_REVIEW_TYPES` constant + `REVIEW_TYPE_SECTIONS` mapping) with a `test_quality` type. Update the GitHub Agent triage prompt to detect test-heavy PRs and auto-select `test_quality`. Add a dedicated review section in the orchestrator system prompt with specialized test review criteria.

**Tech Stack:** TypeScript, Zod, Vitest

---

## File Structure

| File                                                                     | Action                  | Responsibility                                                                                                                    |
| ------------------------------------------------------------------------ | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `apps/code-agent/src/domain/constants/reviewTypes.ts`                    | Modify                  | Add `'test_quality'` to `ALL_REVIEW_TYPES` and `LLM_TOOL_REVIEW_TYPES`                                                            |
| `apps/code-agent/src/domain/validation/triageSchema.ts`                  | Auto (no change needed) | Uses `ALL_REVIEW_TYPES` const — picks up new value automatically                                                                  |
| `apps/code-agent/src/domain/prompts/githubAgentPrompt.ts`                | Modify                  | Add `test_quality` to review type guidelines                                                                                      |
| `workers/orchestrator/src/types/schemas.ts`                              | Modify                  | Add `'test_quality'` to Zod enum                                                                                                  |
| `workers/orchestrator/src/services/system-prompt.ts`                     | Modify                  | Add `test_quality` section to `REVIEW_TYPE_SECTIONS`, bump `reviewPrompt` version, add `test_quality` description to review scope |
| `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`      | Modify                  | Add tests for `test_quality` review type rendering                                                                                |
| `apps/code-agent/src/__tests__/domain/constants/reviewTypes.test.ts`     | Create                  | Test that `ALL_REVIEW_TYPES` and `LLM_TOOL_REVIEW_TYPES` include `test_quality`                                                   |
| `apps/code-agent/src/__tests__/domain/prompts/githubAgentPrompt.test.ts` | Modify or Create        | Test that `test_quality` appears in review type guidelines                                                                        |

## Contracts Between Services

### code-agent -> orchestrator contract

The `reviewTypes` field in the task dispatch request is the integration boundary:

```typescript
// Shared contract: reviewTypes array values
// code-agent sends: reviewTypes: ['test_quality', ...]
// orchestrator validates via Zod: z.enum([..., 'test_quality'])
// orchestrator renders via: REVIEW_TYPE_SECTIONS['test_quality']
```

Both services must accept `'test_quality'` as a valid enum value. The code-agent subtask adds it to `ALL_REVIEW_TYPES`; the orchestrator subtask adds it to its Zod schema and `REVIEW_TYPE_SECTIONS`.

### Shared type value: `'test_quality'`

This string literal is the contract. Each service owns its own validation and rendering, but both must accept this exact value.

---

## Task 1: code-agent — Add `test_quality` review type and GitHub Agent detection

**Subissue scope:** All changes within `apps/code-agent/`.

**Files:**
- Modify: `apps/code-agent/src/domain/constants/reviewTypes.ts`
- Modify: `apps/code-agent/src/domain/prompts/githubAgentPrompt.ts`
- Create: `apps/code-agent/src/__tests__/domain/constants/reviewTypes.test.ts`
- Modify (if exists) or Create: `apps/code-agent/src/__tests__/domain/prompts/githubAgentPrompt.test.ts`

### Step-by-step

- [ ] **Step 1: Write test for reviewTypes constant**

Create `apps/code-agent/src/__tests__/domain/constants/reviewTypes.test.ts` (note: the `__tests__/domain/constants/` directory does not exist yet — the Write tool creates parent directories automatically):

```typescript
import { describe, it, expect } from 'vitest';
import { ALL_REVIEW_TYPES, LLM_TOOL_REVIEW_TYPES } from '../../../domain/constants/reviewTypes.js';

describe('reviewTypes constants', () => {
  it('ALL_REVIEW_TYPES includes test_quality', () => {
    expect(ALL_REVIEW_TYPES).toContain('test_quality');
  });

  it('LLM_TOOL_REVIEW_TYPES includes test_quality', () => {
    expect(LLM_TOOL_REVIEW_TYPES).toContain('test_quality');
  });

  it('LLM_TOOL_REVIEW_TYPES excludes plan_review', () => {
    expect(LLM_TOOL_REVIEW_TYPES).not.toContain('plan_review');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/constants/reviewTypes.test.ts`
Expected: FAIL — `test_quality` not found in arrays.

- [ ] **Step 3: Add `test_quality` to `ALL_REVIEW_TYPES`**

Modify `apps/code-agent/src/domain/constants/reviewTypes.ts`:

```typescript
export const ALL_REVIEW_TYPES = ['code_quality', 'security', 'architecture', 'plan_review', 'test_quality'] as const;
export type ReviewType = (typeof ALL_REVIEW_TYPES)[number];

export const LLM_TOOL_REVIEW_TYPES = ALL_REVIEW_TYPES.filter(
  (t): t is Exclude<ReviewType, 'plan_review'> => t !== 'plan_review'
);
```

Key: `test_quality` is NOT excluded from `LLM_TOOL_REVIEW_TYPES` — the LLM should be able to select it during triage, unlike `plan_review` which is deterministic.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/constants/reviewTypes.test.ts`
Expected: PASS

- [ ] **Step 5: Write test for GitHub Agent prompt containing test_quality**

Add the following test inside the existing `describe('PR section', () => {...})` block in `apps/code-agent/src/__tests__/domain/prompts/githubAgentPrompt.test.ts` (do NOT create a new top-level `describe('githubAgentPrompt', ...)`):

```typescript
it('includes test_quality in review type guidelines for PR events', () => {
  const result = githubAgentPrompt.build({
    repository: 'owner/repo',
    prNumber: 1,
    prTitle: 'Test PR',
    prBody: 'body',
    action: 'opened',
    senderLogin: 'user',
    eventType: 'pull_request',
    files: [],
  });
  expect(result).toContain('test_quality');
  expect(result).toContain('false positives');
  expect(result).toContain('v8 ignore');
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/prompts/githubAgentPrompt.test.ts`
Expected: FAIL — `test_quality` not found in prompt output.

- [ ] **Step 7: Update GitHub Agent prompt with test_quality guideline**

Modify `apps/code-agent/src/domain/prompts/githubAgentPrompt.ts`, in the `buildPRSection` function's review type guidelines section (around line 79-84). Add after the architecture guideline:

```typescript
'- **test_quality**: Test quality review. Request when PR has significant test file changes (.test.ts, .spec.ts). Checks for false positives, testing granularity, v8 ignore legitimacy, and test design.',
```

Also add Example 4 after the existing Example 3 (around line 115):

```typescript
'Example 4 — PR with significant test file changes:',
'1. Call `request_review({"review_type":"code_quality"})`',
'2. Call `request_review({"review_type":"test_quality"})`',
'3. Respond: "Requested code_quality and test_quality reviews for test-heavy PR."',
```

Also bump the prompt version from `'5.1.1'` to `'6.0.0'` (major: new review type changes LLM decision-making behavior per CLAUDE.md versioning rules).

- [ ] **Step 7b: Update version test assertion and description**

In `apps/code-agent/src/__tests__/domain/prompts/githubAgentPrompt.test.ts`, find the existing version test (line 9):
```typescript
it('has version 5.0.0', () => {          // ← misleading description
  expect(githubAgentPrompt.version).toBe('5.1.1');  // ← stale after bump
});
```
Update both the description and assertion:
```typescript
it('has version 6.0.0', () => {
  expect(githubAgentPrompt.version).toBe('6.0.0');
});
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/prompts/githubAgentPrompt.test.ts`
Expected: PASS

- [ ] **Step 9: Run code-agent workspace verification**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent`
Expected: All tests pass, coverage met.

- [ ] **Step 10: Commit**

```bash
git add apps/code-agent/src/domain/constants/reviewTypes.ts \
       apps/code-agent/src/domain/prompts/githubAgentPrompt.ts \
       apps/code-agent/src/__tests__/domain/constants/reviewTypes.test.ts \
       apps/code-agent/src/__tests__/domain/prompts/githubAgentPrompt.test.ts
git commit -m "feat(code-agent): add test_quality review type and GitHub Agent detection"
```

---

## Task 2: orchestrator — Add `test_quality` review section and schema validation

**Subissue scope:** All changes within `workers/orchestrator/`.

**Files:**
- Modify: `workers/orchestrator/src/types/schemas.ts`
- Modify: `workers/orchestrator/src/services/system-prompt.ts`
- Modify: `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`

### Step-by-step

- [ ] **Step 1: Write test for test_quality review type rendering**

First, update the existing test `'includes all review type sections when reviewTypes is undefined'` (around line 892) to also assert the new type:

```typescript
// Add this line after the existing expect(result).toContain('📐 Plan Review') assertion:
expect(result).toContain('🧪 Test Quality');
```

Also update the existing test `'includes only requested review type sections when reviewTypes is specified'` (around line 902, using `['code_quality', 'security']`) to add:
```typescript
expect(result).not.toContain('🧪 Test Quality');
```

Then add the following new tests to `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`, in the review prompt test suite (insert before the `'REVIEW_AGENT_FINAL block'` test, around line 949):

```typescript
it('includes only test_quality section when reviewTypes is ["test_quality"]', () => {
  const result = reviewPrompt.build({ ...baseParams, reviewTypes: ['test_quality'] });
  expect(result).toContain('🧪 Test Quality');
  expect(result).toContain('Verdict:');
  expect(result).not.toContain('🔍 Code Quality');
  expect(result).not.toContain('🔒 Security');
  expect(result).not.toContain('🏗️ Architecture');
  expect(result).not.toContain('📐 Plan Review');
});

it('includes test_quality alongside other types when both are requested', () => {
  const result = reviewPrompt.build({ ...baseParams, reviewTypes: ['code_quality', 'test_quality'] });
  expect(result).toContain('🔍 Code Quality');
  expect(result).toContain('🧪 Test Quality');
  expect(result).not.toContain('🔒 Security');
});

it('includes test_quality in the review scope description', () => {
  const result = reviewPrompt.build(baseParams);
  expect(result).toContain('**test_quality**');
  expect(result).toContain('False positives');
  expect(result).toContain('v8 ignore legitimacy');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /repo && pnpm vitest run workers/orchestrator/src/services/__tests__/system-prompt.test.ts`
Expected: FAIL — `🧪 Test Quality` not found.

- [ ] **Step 3: Add `test_quality` to Zod schema**

Modify `workers/orchestrator/src/types/schemas.ts` line 48, add `'test_quality'` to the enum:

```typescript
reviewTypes: z
  .array(z.enum(['code_quality', 'security', 'architecture', 'plan_review', 'test_quality']))
  .optional(),
```

- [ ] **Step 4: Add `test_quality` to `REVIEW_TYPE_SECTIONS`**

Modify `workers/orchestrator/src/services/system-prompt.ts`, add a new entry to `REVIEW_TYPE_SECTIONS` (after `plan_review`, around lines 554–568):

```typescript
test_quality: `### 🧪 Test Quality
**Verdict:** Thorough / Minor gaps / Needs rework
- Finding 1...`,
```

- [ ] **Step 5: Add `test_quality` description to review scope section**

In the same file, find the review scope section in `reviewPrompt.build()` (around line 649-652). Add after the `plan_review` bullet:

```
- **test_quality**: Test quality review. Analyze test files for: (1) False positives — tests that pass but don't actually verify behavior (e.g., asserting on mock return values, testing implementation details not behavior, trivially true assertions). (2) Testing granularity — tests that are too coarse (testing multiple behaviors in one test) or too fine (testing private internals). (3) v8 ignore legitimacy — for every \`/* v8 ignore */\` comment, verify the branch is genuinely untestable per the project's coverage-exemptions rules (category must be valid, explanation must name the testing BLOCKER not describe the code, the branch must not be testable via mocks/fakes). Flag any v8 ignore that looks like LLM laziness. (4) Test isolation — tests that leak state, depend on execution order, or share mutable fixtures. (5) Assertion quality — weak assertions (toBeTruthy vs toStrictEqual), missing error message assertions, no negative test cases.
```

- [ ] **Step 6: Bump `reviewPrompt` version**

In `workers/orchestrator/src/services/system-prompt.ts`, change the reviewPrompt version from `'6.1.1'` to `'7.0.0'` (major: new review type changes reviewer behavior per CLAUDE.md versioning rules).

- [ ] **Step 7: Run test to verify it passes**

Run: `cd /repo && pnpm vitest run workers/orchestrator/src/services/__tests__/system-prompt.test.ts`
Expected: PASS

- [ ] **Step 8: Run orchestrator workspace verification**

Run: `cd /repo && pnpm run verify:workspace:tracked -- orchestrator`
Expected: All tests pass, coverage met.

- [ ] **Step 9: Commit**

```bash
git add workers/orchestrator/src/types/schemas.ts \
       workers/orchestrator/src/services/system-prompt.ts \
       workers/orchestrator/src/services/__tests__/system-prompt.test.ts
git commit -m "feat(orchestrator): add test_quality review type with specialized test review criteria"
```

---

## Endpoint Changes

- **Modified:** None — no HTTP endpoints change
- **Created:** None
- **Removed:** None
- **Unchanged:** `POST /tasks` (orchestrator) — accepts new `test_quality` value in existing `reviewTypes` array field; `POST /internal/review-task` (code-agent) — routes new value through existing flow

## Design Decisions

### Why `test_quality` is in `LLM_TOOL_REVIEW_TYPES` (not excluded like `plan_review`)

`plan_review` is excluded because plan-only PRs are detected deterministically by `evaluatePlanFiles()` before the LLM runs. There is no equivalent deterministic detection for test-heavy PRs — the LLM needs to see the file list and decide whether `test_quality` review is appropriate based on the ratio and nature of test file changes.

### v8 Ignore Review Criteria

The `test_quality` review type includes specific v8 ignore validation criteria derived from the project's `coverage-exemptions.md`:
- Valid categories: `ts-type`, `regex`, `module-init`, `async-timing`, `test-infra`, `upstream`, `module-mock`, `schema`, `source-map`, `auth-guard`
- Explanation must name the testing BLOCKER (e.g., "FakeHttpClient cannot simulate AbortError"), not describe the code
- Catch blocks, error paths, validation branches, null guards are NEVER valid for v8 ignore
- The reviewer should flag any v8 ignore where a mock/fake could trigger the branch

### Test False Positive Indicators

The reviewer checks for these common LLM-generated test anti-patterns:
- Asserting that a mock returns what you told it to return
- `expect(result).toBeDefined()` when a stronger assertion is possible
- Testing that a function was called (spy verification) without testing the effect
- `toContain` on a large string when an exact match is feasible
- Tests that only exercise the happy path with no edge cases
- Tests with no assertions (relying solely on "no error thrown")

### No Completion Verifier Changes Needed

The `REVIEW_SCHEMA` in `completion-verifier.ts` validates `review_types` as a non-empty string (free-form, not enum-validated). Adding `test_quality` requires no changes to the verifier — it will accept `"test_quality"` in the comma-separated output.
