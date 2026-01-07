# TASK-15: Migrate All Test Files

## Status: PENDING

## Depends On: TASK-04 through TASK-14

## Objective

Replace all hardcoded model and provider strings in test files with `LlmModels` and `LlmProviders` constants.

## Scale

From violations-baseline.txt, approximately **600+ violations** are in test files.

## Test Files by App

### llm-orchestrator (~200 violations)

| File | Approx Violations |
|------|-------------------|
| `__tests__/domain/research/usecases/checkLlmCompletion.test.ts` | 50+ |
| `__tests__/domain/research/usecases/processResearch.test.ts` | 40+ |
| `__tests__/domain/research/usecases/retryFailedLlms.test.ts` | 30+ |
| `__tests__/domain/research/usecases/retryFromFailed.test.ts` | 30+ |
| `__tests__/domain/research/usecases/runSynthesis.test.ts` | 40+ |
| `__tests__/domain/research/usecases/enhanceResearch.test.ts` | 25+ |
| `__tests__/domain/research/usecases/unshareResearch.test.ts` | 5+ |
| `__tests__/domain/research/utils/costCalculator.test.ts` | 10+ |
| `__tests__/domain/research/utils/htmlGenerator.test.ts` | 10+ |
| `__tests__/fakes.ts` | 10+ |
| `__tests__/routes.test.ts` | 20+ |

### commands-router (~60 violations)

| File | Approx Violations |
|------|-------------------|
| `__tests__/infra/classifier.test.ts` | 30+ |
| `__tests__/infra/pubsub/actionEventPublisher.test.ts` | 10+ |
| `__tests__/routes.test.ts` | 15+ |
| `__tests__/usecases/retryPendingCommands.test.ts` | 5+ |

### image-service (~90 violations)

| File | Approx Violations |
|------|-------------------|
| `__tests__/FakeImageGenerator.test.ts` | 10+ |
| `__tests__/GeminiPromptAdapter.test.ts` | 5+ |
| `__tests__/infra/GoogleImageGenerator.test.ts` | 15+ |
| `__tests__/infra/OpenAIImageGenerator.test.ts` | 15+ |
| `__tests__/infra/firestore/generatedImageRepository.test.ts` | 5+ |
| `__tests__/internalRoutes.test.ts` | 20+ |
| `__tests__/models.test.ts` | 15+ |
| `__tests__/services.test.ts` | 5+ |
| `__tests__/fakes.ts` | 5+ |

### actions-agent (~15 violations)

| File | Approx Violations |
|------|-------------------|
| `__tests__/infra/research/llmOrchestratorClient.test.ts` | 15 |

### app-settings-service (~15 violations)

| File | Approx Violations |
|------|-------------------|
| `__tests__/infra/FirestorePricingRepository.test.ts` | 5+ |
| `__tests__/routes/internalRoutes.test.ts` | 10+ |

### llm-pricing (~20 violations)

| File | Approx Violations |
|------|-------------------|
| `__tests__/pricingClient.test.ts` | 20+ |

## Pattern to Apply

```typescript
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';

// Replace in test data:
// FROM:
const research = createTestResearch({
  selectedModels: ['gemini-2.5-pro', 'o4-mini-deep-research'],
  synthesisModel: 'gemini-2.5-pro',
});

// TO:
const research = createTestResearch({
  selectedModels: [LlmModels.Gemini25Pro, LlmModels.O4MiniDeepResearch],
  synthesisModel: LlmModels.Gemini25Pro,
});

// Replace in assertions:
// FROM:
expect(result.model).toBe('gemini-2.5-pro');

// TO:
expect(result.model).toBe(LlmModels.Gemini25Pro);

// Replace in mock data:
// FROM:
{ provider: 'google', model: 'gemini-2.5-pro', status: 'completed' }

// TO:
{ provider: LlmProviders.Google, model: LlmModels.Gemini25Pro, status: 'completed' }
```

## Execution Strategy

Process test files in order of source file migration:
1. After TASK-04 (domain layer) → migrate domain test files
2. After TASK-05 (infra/routes) → migrate infra/routes test files
3. After TASK-06-14 → migrate respective app test files

## Validation

```bash
npm run test
npx tsx scripts/verify-llm-architecture.ts 2>&1 | grep -c "RULE-4"
# Should be 0
```

## Acceptance Criteria

- [ ] All test files use `LlmModels.*` constants
- [ ] All test files use `LlmProviders.*` constants
- [ ] All tests pass
- [ ] Verification script shows 0 RULE-4 violations
- [ ] Verification script shows 0 RULE-5 violations

