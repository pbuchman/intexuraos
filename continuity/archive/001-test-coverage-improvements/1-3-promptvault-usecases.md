# 1-3 - Add Tests for promptvault-service Use Cases

**Tier:** 1 (Depends on: ALL Tier 0 issues must be complete)

---

## Prerequisites

Before starting this issue, ensure these are complete:

- [x] `0-0-narrow-coverage-exclusions.md` - Coverage config is cleaned up
- [x] `0-1-common-package-coverage.md` - Common utilities are tested
- [x] `0-2-standardize-test-utilities.md` - Test patterns are documented

---

## Context Snapshot

### Repo Constraints (from .github/copilot-instructions.md)

- Coverage target: 90%
- Test runner: Vitest with v8 coverage provider
- Domain logic in `src/domain/**` has no external deps
- Mock external systems only (Notion, Firestore)
- Run `npm run ci` to verify all checks pass

### Coverage Tooling

- Test command: `npm run test:coverage`
- Test location: `apps/promptvault-service/src/__tests__/`

### Changes from Tier 0

- Coverage exclusions have been narrowed (see 0-0)
- Test utility patterns documented (see 0-2)
- Fakes patterns reviewed (see 0-2)

---

## Problem Statement

Current coverage for promptvault use cases (`apps/promptvault-service/src/domain/promptvault/usecases/`):

- `createPromptUseCase.ts`: **52.38%** (lines 45, 58-59, 71-74 uncovered)
- `getPromptUseCase.ts`: **63.63%** (lines 22-23, 36-37, 46-49 uncovered)
- `listPromptsUseCase.ts`: **66.66%** (lines 29-32 uncovered)
- `updatePromptUseCase.ts`: **45.45%** (lines 65, 79-80, 92-95 uncovered)

These are core business logic files with low coverage.

---

## Scope

### In Scope

- `apps/promptvault-service/src/domain/promptvault/usecases/createPromptUseCase.ts`
- `apps/promptvault-service/src/domain/promptvault/usecases/getPromptUseCase.ts`
- `apps/promptvault-service/src/domain/promptvault/usecases/listPromptsUseCase.ts`
- `apps/promptvault-service/src/domain/promptvault/usecases/updatePromptUseCase.ts`
- `apps/promptvault-service/src/domain/promptvault/DomainErrorCode.ts`

### Out of Scope

- Route handlers (covered by existing integration tests)
- Notion/Firestore adapters (Tier 2 issue)

---

## Required Approach

- **Testing style**: Unit tests for use case functions
- **Mocking strategy**:
  - Create mock implementations of repository interfaces
  - Mock Notion API responses
  - Use Result types for error scenarios
  - Use fakes established in 0-2
- **Architecture boundaries**: Test domain logic in isolation from infra

---

## Steps

1. Read use case files:

===
cat apps/promptvault-service/src/domain/promptvault/usecases/createPromptUseCase.ts
cat apps/promptvault-service/src/domain/promptvault/usecases/updatePromptUseCase.ts
===

2. Read existing test patterns (reviewed in 0-2):

===
cat apps/promptvault-service/src/**tests**/promptRoutes.test.ts
cat apps/promptvault-service/src/**tests**/fakes.ts
===

3. Create unit test file:
   - `apps/promptvault-service/src/__tests__/usecases.test.ts`

4. Add tests for each use case:
   - createPromptUseCase:
     - Success case
     - Validation error (missing title)
     - Notion API error
     - Connection not found error
   - getPromptUseCase:
     - Success case
     - Prompt not found
     - Connection not found
   - listPromptsUseCase:
     - Success with prompts
     - Empty list
     - Connection not found
   - updatePromptUseCase:
     - Success case
     - Prompt not found
     - Validation error
     - Notion API error

5. Run verification:

===
npm run test:coverage
npm run ci
===

---

## Definition of Done

- [ ] All use case files have ≥ 85% coverage
- [ ] Error paths are tested
- [ ] Success paths are tested
- [ ] `npm run ci` passes

---

## Verification Commands

===
npm run test:coverage
npm run ci
===

---

## Rollback Plan

If tests fail due to Result type handling:

1. Review Result/err/ok patterns in @intexuraos/common
2. Use isErr/isOk helpers for assertions
