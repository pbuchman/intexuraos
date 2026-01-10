# Remove Coverage Exclusions - Continuity Ledger

## Goal

Remove unjustified coverage exclusions from vitest.config.ts by writing tests for currently excluded code. User has granted explicit permission to modify vitest.config.ts.

**Success Criteria:**

- All listed exclusions investigated ✅
- Tests written where feasible ✅
- Exclusions removed from vitest.config.ts ✅
- Coverage thresholds still passing (95%) ✅

## Constraints / Assumptions

- Permission granted to modify vitest.config.ts (normally protected)
- Some exclusions may be legitimately untestable (pure SDK wrappers)
- Must maintain 95% coverage thresholds after changes

## Key Decisions

1. **infra-whatsapp and routes already have tests** - Removed exclusions after fixing JWT authentication in routes tests
2. **Added types.ts exclusion** - `packages/infra-*/src/types.ts` are pure interface files with no runtime code
3. **Routes tests fixed** - Changed from fake JWT/nock to real jose key pair + local JWKS server
4. **SDK mocking pattern** - Used vi.mock with mock classes that include static error types for instanceof checks

## Reasoning Narrative

### Investigation Results

| Exclusion                                                                     | Finding                                   | Action                         | Status  |
| ----------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------ | ------- |
| packages/infra-whatsapp/\*\*                                                  | Tests exist in `__tests__/client.test.ts` | Removed exclusion              | ✅ Done |
| apps/research-agent-service/src/routes/\*\*                                 | Tests exist but had broken JWT auth       | Fixed tests, removed exclusion | ✅ Done |
| packages/infra-\*/src/types.ts                                                | Pure TypeScript interfaces                | Added exclusion (justified)    | ✅ Done |
| packages/infra-claude/\*\*                                                    | SDK wrapper, testable with vi.mock        | Tests written, removed         | ✅ Done |
| packages/infra-gemini/\*\*                                                    | SDK wrapper, testable with vi.mock        | Tests written, removed         | ✅ Done |
| packages/infra-gpt/\*\*                                                       | SDK wrapper, testable with vi.mock        | Tests written, removed         | ✅ Done |
| packages/infra-llm-audit/\*\*                                                 | Pure functions + Firestore                | Tests written, removed         | ✅ Done |
| apps/research-agent-service/src/infra/\*\*                                  | Factory + Firestore repo                  | Tests written, removed         | ✅ Done |
| apps/research-agent-service/src/domain/research/config/\*\*                 | Pure function                             | Tests written, removed         | ✅ Done |
| apps/research-agent-service/src/domain/research/usecases/processResearch.ts | Full DI, testable                         | Tests written, removed         | ✅ Done |

### Work Completed

1. **Removed `packages/infra-whatsapp/**` exclusion\*\*
   - Already had comprehensive tests using nock for HTTP mocking
   - Coverage: 100% across all metrics

2. **Removed `apps/research-agent-service/src/routes/**` exclusion\*\*
   - Fixed routes tests by implementing proper JWT authentication:
     - Used `jose` library to generate real RSA key pairs
     - Created local Fastify JWKS server to serve public key
     - Properly signed JWTs with `jose.SignJWT`
   - Coverage increased from 31.66% to 100%

3. **Added `packages/infra-*/src/types.ts` exclusion**
   - Justified: Pure TypeScript interfaces with no runtime code

4. **Created `packages/infra-gemini/src/__tests__/client.test.ts`** (30 tests)
   - Mocks @google/genai SDK
   - Tests research, synthesize, generateTitle, validateKey
   - Edge cases for null responses, source extraction, grounding chunks

5. **Created `packages/infra-gpt/src/__tests__/client.test.ts`** (32 tests)
   - Mocks openai SDK with MockAPIError class for instanceof checks
   - Tests both responses.create and chat.completions.create APIs
   - Comprehensive error mapping tests

6. **Created `packages/infra-llm-audit/src/__tests__/audit.test.ts`** (21 tests)
   - Tests isAuditEnabled() with various env var values
   - Tests AuditContext success/error paths
   - Tests idempotency and Firestore error handling

7. **Created research-agent infra tests:**
   - `FirestoreResearchRepository.test.ts` (18 tests) - CRUD operations
   - `userServiceClient.test.ts` (11 tests) - HTTP mocking with nock
   - `LlmAdapterFactory.test.ts` (7 tests) - Factory functions
   - `ClaudeAdapter.test.ts` (8 tests) - Delegation and error mapping

8. **Created `processResearch.test.ts`** (17 tests)
   - Full integration tests with mocked dependencies
   - Tests all execution paths including errors

9. **Created `synthesisPrompt.test.ts`** (12 tests)
   - Tests pure functions and constants
   - Tests buildSynthesisInput function

### Final Coverage

```
All files: Lines 98.18%, Branches 95.18%, Functions 98.89%, Statements 98.1%
```

All metrics above 95% threshold.

## State

### Done

- ✅ Investigated all 9 exclusion categories
- ✅ Removed infra-whatsapp exclusion (already had tests)
- ✅ Fixed research-agent routes tests with proper JWT signing
- ✅ Removed routes exclusion
- ✅ Added justified types.ts exclusion
- ✅ Wrote tests for infra-gemini (30 tests)
- ✅ Wrote tests for infra-gpt (32 tests)
- ✅ Wrote tests for infra-llm-audit (21 tests)
- ✅ Wrote tests for research-agent infra (44 tests across 4 files)
- ✅ Wrote tests for processResearch.ts (17 tests)
- ✅ Wrote tests for synthesisPrompt.ts (12 tests)
- ✅ Removed all unjustified exclusions
- ✅ CI passes

### Now

**TASK COMPLETE**

### Next

None - all tasks completed.

## Files Modified

- `vitest.config.ts` - Removed 7 unjustified exclusions, kept justified ones
- `apps/research-agent-service/src/__tests__/routes.test.ts` - Complete rewrite with proper JWT auth
- `packages/infra-gemini/src/__tests__/client.test.ts` - New test file (30 tests)
- `packages/infra-gpt/src/__tests__/client.test.ts` - New test file (32 tests)
- `packages/infra-llm-audit/src/__tests__/audit.test.ts` - New test file (21 tests)
- `apps/research-agent-service/src/__tests__/infra/research/FirestoreResearchRepository.test.ts` - New (18 tests)
- `apps/research-agent-service/src/__tests__/infra/user/userServiceClient.test.ts` - New (11 tests)
- `apps/research-agent-service/src/__tests__/infra/llm/LlmAdapterFactory.test.ts` - New (7 tests)
- `apps/research-agent-service/src/__tests__/infra/llm/ClaudeAdapter.test.ts` - New (8 tests)
- `apps/research-agent-service/src/__tests__/domain/research/usecases/processResearch.test.ts` - New (17 tests)
- `apps/research-agent-service/src/__tests__/domain/research/config/synthesisPrompt.test.ts` - New (12 tests)
