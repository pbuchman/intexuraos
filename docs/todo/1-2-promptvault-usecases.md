# 1-2 - Promptvault Usecases Coverage (52-78% → 85%)

**Tier:** 1 (Depends on: 0-0-review-exclusions.md, 0-1-test-utility-improvements.md)

---

## Context Snapshot

### Repo Constraints (from .github/copilot-instructions.md)

- Coverage target: 90/85/85/90 (lines/branches/functions/statements)
- Test runner: Vitest with v8 coverage provider
- Architecture: Domain usecases in `src/domain/promptvault/usecases/`
- Mock external systems only (Notion for prompts)
- Assert observable behavior, not implementation
- Run `npm run ci` to verify all checks pass

### Coverage Tooling

- Test command: `npm run test:coverage`
- Current coverage:
  - CreatePromptUseCase.ts: 78.57%
  - GetPromptUseCase.ts: 63.63%
  - ListPromptsUseCase.ts: 66.66%
  - UpdatePromptUseCase.ts: 52.72%

---

## Problem Statement

The promptvault domain usecases have varying coverage levels, with UpdatePromptUseCase at only 52.72%. These usecases contain business logic for CRUD operations on prompts.

Uncovered areas:
- UpdatePromptUseCase (52.72%): lines 51, 56-65, 92-95
- GetPromptUseCase (63.63%): lines 22-23, 36-37, 46-49
- ListPromptsUseCase (66.66%): lines 29-32
- CreatePromptUseCase (78.57%): lines 41-45, 71-74

---

## Scope

### In Scope

- `apps/promptvault-service/src/domain/promptvault/usecases/*.ts`
- Creating/extending usecase test files
- Using existing fakes from `fakes.ts`

### Out of Scope

- Route integration tests
- Actual Notion API calls
- Changes to usecase logic

---

## Required Approach

- **Unit tests** - Test usecase functions directly
- **Mock strategy**:
  - Use `FakePromptRepository` from fakes.ts
  - Use `FakeNotionConnectionRepository` for connection checks
- **Test coverage priorities**:
  1. Error handling paths
  2. Edge cases (empty inputs, not found)
  3. Validation failures

---

## Steps

1. Read the usecase source files:

===
cat apps/promptvault-service/src/domain/promptvault/usecases/CreatePromptUseCase.ts
cat apps/promptvault-service/src/domain/promptvault/usecases/GetPromptUseCase.ts
cat apps/promptvault-service/src/domain/promptvault/usecases/ListPromptsUseCase.ts
cat apps/promptvault-service/src/domain/promptvault/usecases/UpdatePromptUseCase.ts
===

2. Read existing tests:

===
ls apps/promptvault-service/src/__tests__/*.test.ts
cat apps/promptvault-service/src/__tests__/usecases.test.ts 2>/dev/null || echo "No usecases.test.ts"
===

3. Read the fakes:

===
cat apps/promptvault-service/src/__tests__/fakes.ts
===

4. Create/extend test file `usecases.test.ts` with cases for:

   a. **CreatePromptUseCase**:
   - Successful creation
   - Validation error (missing title)
   - Validation error (missing content)
   - Repository error during creation

   b. **GetPromptUseCase**:
   - Prompt found
   - Prompt not found
   - Repository error

   c. **ListPromptsUseCase**:
   - Empty list
   - List with prompts
   - Repository error

   d. **UpdatePromptUseCase**:
   - Successful update (title only)
   - Successful update (content only)
   - Successful update (both)
   - Prompt not found
   - Validation error (empty title)
   - Repository error

5. Ensure test isolation - each test should not depend on others

6. Run coverage to verify improvement:

===
npm run test:coverage 2>&1 | grep "UseCase"
===

---

## Definition of Done

- [ ] All usecase files ≥ 85% line coverage
- [ ] All usecase files ≥ 80% branch coverage
- [ ] Error paths explicitly tested
- [ ] Validation scenarios covered
- [ ] `npm run ci` passes
- [ ] No flaky tests introduced

---

## Verification Commands

Check specific file coverage:
===
npm run test:coverage 2>&1 | grep -E "UseCase|usecases"
===

Run full CI:
===
npm run ci
===

---

## Rollback Plan

If tests fail due to interface mismatches:
1. Update fakes to match current repository interfaces
2. Verify the fake implementations return correct types

