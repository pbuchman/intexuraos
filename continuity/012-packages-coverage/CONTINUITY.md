# Continuity Task 012: Packages Test Coverage

## Goal

Achieve maximum test coverage for all packages/\* modules. Every branch must be covered with tests, including defensively coded branches that may be unreachable in normal execution.

### Success Criteria

- All packages have tests in correct `src/__tests__/` subdirectory
- Coverage thresholds met for all package files (90% lines, 90% statements, 90% functions, 80% branches)
- All defensive/unreachable branches are tested or documented as intentionally excluded

## Constraints / Assumptions

- Tests use Vitest with existing test patterns
- No external services required (use mocks/fakes)
- Follow existing test file naming conventions (`*.test.ts`)

## Key Decisions

- [2024-12-28] Decision: Remove exclusion for decomposed packages from vitest.config.ts coverage
- [2024-12-28] Decision: Create dedicated test files for each package module

## Reasoning Narrative

### Initial Analysis

Analyzed packages/\* structure:

- `packages/common-core` - Result types, errors, redaction (NO TESTS - excluded from coverage)
- `packages/common-http` - Fastify plugin, auth, validation (NO TESTS - excluded from coverage)
- `packages/infra-firestore` - Firestore singleton, fake implementation (NO TESTS - excluded from coverage)
- `packages/infra-notion` - Notion client, connection repository (NO TESTS - excluded from coverage)
- `packages/http-server` - Health checks, validation handler (HAS TESTS - partially covered)
- `packages/http-contracts` - Schema definitions (HAS TESTS - well covered)

Current coverage status (packages/\* only):

- http-server/src/health.ts: 59.09% lines, 82.35% functions (NEEDS WORK)
- http-server/src/validation-handler.ts: 100% (GOOD)
- http-contracts: 100% (GOOD)
- common-core: EXCLUDED (NEEDS TESTS)
- common-http: EXCLUDED (NEEDS TESTS)
- infra-firestore: EXCLUDED (NEEDS TESTS)
- infra-notion: EXCLUDED (NEEDS TESTS)

## State

### Done

- [x] Initial analysis of packages structure
- [x] Review existing test patterns

### Now

- [ ] Create INSTRUCTIONS.md and task files

### Next

- [ ] Tier 0: Verify test file locations
- [ ] Tier 1: Create tests for common-core
- [ ] Tier 1: Create tests for common-http
- [ ] Tier 1: Create tests for infra-firestore
- [ ] Tier 1: Create tests for infra-notion
- [ ] Tier 1: Improve http-server/health.ts coverage
- [ ] Tier 2: Update vitest.config.ts to remove exclusions
- [ ] Tier 3: Final verification and packages/README.md update

## Open Questions

- None currently

## Working Set

- packages/common-core/src/\*.ts
- packages/common-http/src/\*_/_.ts
- packages/infra-firestore/src/\*.ts
- packages/infra-notion/src/\*.ts
- packages/http-server/src/health.ts
- vitest.config.ts
- packages/README.md
