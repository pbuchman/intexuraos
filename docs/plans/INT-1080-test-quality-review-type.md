# Test Quality Review Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `test_quality` review type that comprehensively reviews TypeScript test code for correctness, best practices, and project-specific patterns. This is NOT limited to v8 ignores or false positives — those are sample categories within a broader test quality review that covers all aspects of well-written tests.

**Architecture:** Extend the existing review type system (`ALL_REVIEW_TYPES` constant + `REVIEW_TYPE_SECTIONS` mapping) with a `test_quality` type. Update the GitHub Agent triage prompt to detect test-heavy PRs and auto-select `test_quality`. Add a dedicated review section in the orchestrator system prompt with comprehensive test review criteria.

**Tech Stack:** TypeScript, Zod, Vitest

---

## Reviewer Prompt Reference (EXACT TEXT)

This section contains the **exact prompt strings** to insert into the codebase. The implementing agent MUST use these verbatim — do not paraphrase, summarize, or rewrite.

### GitHub Agent Triage Guideline (insert into `githubAgentPrompt.ts`)

This is the exact TypeScript string to add to the review type guidelines array in `buildPRSection()`:

```typescript
'- **test_quality**: Test quality review. Request when PR has significant test file changes (.test.ts, .spec.ts). Evaluates test correctness, isolation, assertion strength, DI patterns, and coverage exemption legitimacy.',
```

### Orchestrator Review Scope Description (insert into `system-prompt.ts`)

This is the exact string to add after the `plan_review` bullet in the Review Scope section (around line 652). It becomes part of the system prompt that instructs the review agent what to look for:

```
- **test_quality**: Comprehensive test quality review. Analyze ALL test files in the PR across these categories:

  **(1) False Positives** — Tests that pass but fail to verify actual behavior:
  - Asserting that a mock returns what you configured it to return (circular verification)
  - \`expect(result).toBeDefined()\` or \`expect(result).toBeTruthy()\` when a stronger assertion (\`toStrictEqual\`, \`toMatchObject\`) is feasible
  - Testing that a function was called (spy verification with \`toHaveBeenCalledWith\`) without verifying the observable effect of that call
  - \`toContain\` on a large string when an exact match or structured assertion is possible
  - Tests with zero assertions (relying solely on "no error thrown")
  - Tests that only exercise the happy path with no edge cases or error scenarios

  **(2) Test Isolation & Lifecycle** — Tests must not leak state:
  - Service container pattern: \`setServices({...fakes})\` in \`beforeEach\`, \`resetServices()\` in \`afterEach\` — flag tests that skip either
  - Shared mutable fixtures across tests — each test must set up its own state
  - Tests that depend on execution order (test B fails if test A doesn't run first)
  - Missing cleanup of side effects (nock interceptors, timers, global state)
  - For nock: every test using \`nock()\` must call \`nock.cleanAll()\` in \`afterEach\` or use \`nock.disableNetConnect()\` to catch leaks

  **(3) Assertion Strength** — Assertions must be as specific as possible:
  - Weak type assertions: \`toBeTruthy()\` instead of \`=== true\` (required by strictBooleanExpressions)
  - Missing error message assertions: catching errors without verifying \`.message\` content
  - No negative test cases: only testing what should succeed, never what should fail
  - Using \`toEqual\` when \`toStrictEqual\` would catch type/prototype mismatches
  - Result type handling: tests must narrow with \`if (!result.ok)\` before accessing \`.value\` — never \`(result as any).value\`

  **(4) Testing Granularity** — Right level of abstraction:
  - Too coarse: one test verifying multiple independent behaviors (should be split)
  - Too fine: testing private internals or implementation details instead of public API behavior
  - Missing boundary tests: off-by-one, empty arrays, null inputs, maximum lengths
  - Route tests should use \`app.inject()\` for integration, domain logic should have unit tests

  **(5) Mock & Fake Patterns** — Correct use of test doubles:
  - Using \`vi.fn()\` when an in-memory fake would be more maintainable and realistic
  - Mock return values that don't match the real dependency's type signature
  - Over-mocking: mocking the unit under test instead of its dependencies
  - HTTP mocking: must use \`nock\` for HTTP calls, not manual fetch stubs
  - Fakes should implement the same interface as the real dependency (\`*Deps\` types)

  **(6) v8 Ignore Legitimacy** — For every \`/* v8 ignore */\` comment in test or source files:
  - Category must be one of: \`ts-type\`, \`regex\`, \`module-init\`, \`async-timing\`, \`test-infra\`, \`upstream\`, \`module-mock\`, \`schema\`, \`source-map\`, \`auth-guard\`
  - Explanation must name the TESTING BLOCKER (e.g., "FakeHttpClient cannot simulate AbortError"), not describe the code (e.g., "error handling for failed request")
  - The branch must be genuinely untestable — if a mock/fake could trigger it, the v8 ignore is invalid
  - These patterns are NEVER valid for v8 ignore: catch blocks, error paths, validation branches, conditional returns, if/else branches, default switch cases, null guards
  - Flag any v8 ignore that appears to be LLM laziness (skipping testing effort rather than genuinely untestable code)

  **(7) Test Structure & Naming** — Readability and maintainability:
  - Test descriptions should describe behavior, not implementation ("calculates total with tax" not "calls calculateTax function")
  - \`describe\` blocks should group by feature/behavior, not by method name
  - Arrange-Act-Assert pattern should be clear in each test
  - Test files should mirror source file structure (\`src/foo.ts\` → \`src/__tests__/foo.test.ts\`)

  **(8) TypeScript Strictness in Tests** — Tests must follow the same strict TypeScript rules as production code:
  - \`noUncheckedIndexedAccess\`: use \`arr[0] ?? fallback\` not bare \`arr[0]\`
  - \`exactOptionalPropertyTypes\`: don't assign \`undefined\` to optional properties
  - \`strictBooleanExpressions\`: use \`=== true\` not bare truthiness checks
  - \`String()\` for template literal number interpolation
```

### Orchestrator Review Type Section (insert into `REVIEW_TYPE_SECTIONS` record)

This is the exact TypeScript property to add to the `REVIEW_TYPE_SECTIONS` constant:

```typescript
  test_quality: `### 🧪 Test Quality
**Verdict:** Thorough / Minor gaps / Needs rework
- Finding 1...`,
```

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

Modify `apps/code-agent/src/domain/constants/reviewTypes.ts`. The current content is:

```typescript
export const ALL_REVIEW_TYPES = ['code_quality', 'security', 'architecture', 'plan_review'] as const;
export type ReviewType = (typeof ALL_REVIEW_TYPES)[number];

export const LLM_TOOL_REVIEW_TYPES = ALL_REVIEW_TYPES.filter(
  (t): t is Exclude<ReviewType, 'plan_review'> => t !== 'plan_review'
);
```

Change the `ALL_REVIEW_TYPES` array to include `'test_quality'`:

```typescript
export const ALL_REVIEW_TYPES = ['code_quality', 'security', 'architecture', 'plan_review', 'test_quality'] as const;
export type ReviewType = (typeof ALL_REVIEW_TYPES)[number];

export const LLM_TOOL_REVIEW_TYPES = ALL_REVIEW_TYPES.filter(
  (t): t is Exclude<ReviewType, 'plan_review'> => t !== 'plan_review'
);
```

**Why `test_quality` is NOT excluded from `LLM_TOOL_REVIEW_TYPES`:** `plan_review` is excluded because plan-only PRs are detected deterministically by `evaluatePlanFiles()` before the LLM runs. There is no equivalent deterministic detection for test-heavy PRs — the LLM needs to see the file list and decide whether `test_quality` review is appropriate.

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

**Note on test assertions:** The test checks for `'false positives'` and `'v8 ignore'` because the triage guideline mentions these as examples of what the review evaluates — but in the triage prompt these are just signal words for the LLM, not the exhaustive scope. The full review scope is defined in the orchestrator's review prompt (Task 2).

- [ ] **Step 6: Run test to verify it fails**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/prompts/githubAgentPrompt.test.ts`
Expected: FAIL — `test_quality` not found in prompt output.

- [ ] **Step 7: Update GitHub Agent prompt with test_quality guideline**

Modify `apps/code-agent/src/domain/prompts/githubAgentPrompt.ts`:

**Change 1 — Add guideline** (in the `buildPRSection` function's review type guidelines section, around line 79-84). Add after the architecture guideline line (`'- **architecture**: Architecture review...'`):

```typescript
'- **test_quality**: Test quality review. Request when PR has significant test file changes (.test.ts, .spec.ts). Evaluates test correctness, isolation, assertion strength, DI patterns, and coverage exemption legitimacy.',
```

Use the exact string from the "Reviewer Prompt Reference" section above. The triage prompt intentionally gives a brief summary — the detailed review criteria live in the orchestrator prompt.

**Change 2 — Add Example 4** (after the existing Example 3, around line 115-117). Add these lines after `'2. Respond: "Skipped — documentation-only change."'`:

```typescript
'',
'Example 4 — PR with significant test file changes:',
'1. Call `request_review({"review_type":"code_quality"})`',
'2. Call `request_review({"review_type":"test_quality"})`',
'3. Respond: "Requested code_quality and test_quality reviews for test-heavy PR."',
```

**Change 3 — Bump version** from `'5.1.1'` to `'6.0.0'` (major bump: new review type changes LLM decision-making behavior per CLAUDE.md prompt versioning rules). Change `version: '5.1.1'` to `version: '6.0.0'` on the version property of the `githubAgentPrompt` object (around line 32).

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
  expect(result).toContain('False Positives');
  expect(result).toContain('v8 Ignore Legitimacy');
});
```

**Note on the last test:** The assertions check for `'False Positives'` and `'v8 Ignore Legitimacy'` as section headers within the review scope. These are category headers (capitalized), not just keywords. If the implementing agent uses the exact prompt text from the "Reviewer Prompt Reference" section above, these assertions will pass.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /repo && pnpm vitest run workers/orchestrator/src/services/__tests__/system-prompt.test.ts`
Expected: FAIL — `🧪 Test Quality` not found.

- [ ] **Step 3: Add `test_quality` to Zod schema**

Modify `workers/orchestrator/src/types/schemas.ts`. Find the reviewTypes field (around line 48):

```typescript
// CURRENT:
reviewTypes: z
  .array(z.enum(['code_quality', 'security', 'architecture', 'plan_review']))
  .optional(),

// CHANGE TO:
reviewTypes: z
  .array(z.enum(['code_quality', 'security', 'architecture', 'plan_review', 'test_quality']))
  .optional(),
```

This is a one-line change — just add `'test_quality'` to the Zod enum array.

- [ ] **Step 4: Add `test_quality` to `REVIEW_TYPE_SECTIONS`**

Modify `workers/orchestrator/src/services/system-prompt.ts`. Find the `REVIEW_TYPE_SECTIONS` constant (around lines 554–568). Add a new entry after `plan_review`:

```typescript
const REVIEW_TYPE_SECTIONS: Record<string, string> = {
  code_quality: `### 🔍 Code Quality
**Verdict:** Clean / Minor issues / Needs attention
- Finding 1...
- Finding 2...`,
  security: `### 🔒 Security
**Verdict:** No concerns / Advisory / Blocking
- Finding 1...`,
  architecture: `### 🏗️ Architecture
**Verdict:** Sound / Minor concerns / Needs redesign
- Finding 1...`,
  plan_review: `### 📐 Plan Review
**Verdict:** Ready / Gaps found / Needs rework
- Finding 1...`,
  test_quality: `### 🧪 Test Quality
**Verdict:** Thorough / Minor gaps / Needs rework
- Finding 1...`,
};
```

Use the exact string from the "Reviewer Prompt Reference" section above. This is the template the review agent fills in with its actual findings.

- [ ] **Step 5: Add `test_quality` description to review scope section**

In the same file (`workers/orchestrator/src/services/system-prompt.ts`), find the review scope section in the `reviewPrompt.build()` method (around line 649-652). The current scope descriptions look like this:

```typescript
- **code_quality**: Code style, readability, maintainability, naming conventions, DRY violations, dead code, test coverage gaps
- **security**: Injection vulnerabilities (SQL, XSS, command), authentication/authorization issues, secrets exposure, OWASP top 10
- **architecture**: Separation of concerns, dependency direction, API design, scalability, coupling/cohesion
- **plan_review**: Plan document validation. Read the plan file carefully. ...
```

Add the complete `test_quality` description after the `plan_review` line. Use the **exact text** from the "Orchestrator Review Scope Description" in the "Reviewer Prompt Reference" section above. Copy it verbatim — this is the prompt that instructs the review agent what to analyze.

**Important for the implementing agent:** The test_quality scope description is multi-line with 8 numbered categories. It must be added as a single template literal string continuation within the existing backtick-delimited template. Each `\`` backtick inside the text must be escaped as `\\\`` in the TypeScript template literal.

- [ ] **Step 6: Bump `reviewPrompt` version**

In `workers/orchestrator/src/services/system-prompt.ts`, change the reviewPrompt version from `'6.1.1'` to `'7.0.0'` (major bump: new review type changes reviewer behavior per CLAUDE.md prompt versioning rules). Find `version: '6.1.1'` on the `reviewPrompt` object (around line 609) and change to `version: '7.0.0'`.

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
git commit -m "feat(orchestrator): add test_quality review type with comprehensive test review criteria"
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

### Comprehensive Review Scope — Not Just v8 Ignores

The `test_quality` review type covers **8 categories** of test quality issues. v8 ignore legitimacy and false positives are two of these categories — they are NOT the exclusive focus. The full category list:

1. **False Positives** — tests that pass but don't verify real behavior
2. **Test Isolation & Lifecycle** — DI patterns, cleanup, state leaks
3. **Assertion Strength** — weak vs strong assertions, Result type narrowing
4. **Testing Granularity** — right level of abstraction, boundary tests
5. **Mock & Fake Patterns** — correct test double usage, nock patterns
6. **v8 Ignore Legitimacy** — coverage exemption validation
7. **Test Structure & Naming** — readability, AAA pattern, describe grouping
8. **TypeScript Strictness in Tests** — strict mode compliance in test code

### IntexuraOS-Specific Patterns Reviewed

The review criteria include project-specific patterns derived from CLAUDE.md and codebase conventions:
- `setServices({...fakes})` / `resetServices()` lifecycle (service container DI pattern)
- `app.inject()` for route integration tests
- `nock` for HTTP call mocking with `nock.cleanAll()` cleanup
- Result type narrowing: `if (!result.ok) return result;` before accessing `.value`
- `vi.fn()` vs in-memory fakes (prefer fakes for maintainability)
- `*Deps` type interfaces for dependency injection
- Strict TypeScript rules: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `strictBooleanExpressions`
- v8 ignore categories and blocker keyword enforcement per `coverage-exemptions.md`

### v8 Ignore Review Criteria (detailed)

Valid categories: `ts-type`, `regex`, `module-init`, `async-timing`, `test-infra`, `upstream`, `module-mock`, `schema`, `source-map`, `auth-guard`

Rules the reviewer enforces:
- Explanation must name the testing BLOCKER (e.g., "FakeHttpClient cannot simulate AbortError"), not describe the code (e.g., "error handling for failed request")
- Catch blocks, error paths, validation branches, null guards are NEVER valid for v8 ignore — these are always testable
- If a mock/fake could trigger the branch, the v8 ignore is invalid
- The reviewer flags any v8 ignore that appears to be LLM laziness

### No Completion Verifier Changes Needed

The `REVIEW_SCHEMA` in `completion-verifier.ts` validates `review_types` as a non-empty string (free-form, not enum-validated). Adding `test_quality` requires no changes to the verifier — it will accept `"test_quality"` in the comma-separated output.
