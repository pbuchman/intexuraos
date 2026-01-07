# 029: Type-Safe LLM Model and Provider Constants

## Status: PENDING

## ⚠️ CI Status

**CI is currently failing** due to eslint `@typescript-eslint/no-deprecated` errors for `SupportedModel` usage (53 errors). This is expected and will be resolved when TASK-03 through TASK-07 are executed.

**Blocking errors:**
- 53 eslint errors: `SupportedModel` is deprecated
- These errors exist because `SupportedModel` is marked `@deprecated` in llm-contract but still used in apps

**Non-blocking warnings:**
- RULE-4: 703 hardcoded model strings (warning only until migration complete)
- RULE-5: 357 hardcoded provider strings (warning only until migration complete)

## Objective

Eliminate all hardcoded LLM model strings (e.g., `'gemini-2.5-pro'`) and provider strings (e.g., `'google'`) across the entire codebase. Introduce typed constants via `LlmModels` and `LlmProviders` objects in `llm-contract`. Enforce via verification script.

## Current State (Pre-Migration)

**Verification script output (2026-01-07):**
- RULE-4 (hardcoded model strings): **703 violations**
- RULE-5 (hardcoded provider strings): **357 violations**
- **Total: 1060 violations**

Full violations list: [violations-baseline.txt](./violations-baseline.txt)

## Design Decisions

### 1. Type Structure

Individual model types first, then compose category types:

```typescript
// Individual model types (single source of truth for string values)
export type Gemini25Pro = 'gemini-2.5-pro';
export type Gemini25Flash = 'gemini-2.5-flash';
export type Gemini20Flash = 'gemini-2.0-flash';
export type Gemini25FlashImage = 'gemini-2.5-flash-image';
export type O4MiniDeepResearch = 'o4-mini-deep-research';
export type GPT52 = 'gpt-5.2';
export type GPT4oMini = 'gpt-4o-mini';
export type GPTImage1 = 'gpt-image-1';
export type ClaudeOpus45 = 'claude-opus-4-5-20251101';
export type ClaudeSonnet45 = 'claude-sonnet-4-5-20250929';
export type ClaudeHaiku35 = 'claude-3-5-haiku-20241022';
export type Sonar = 'sonar';
export type SonarPro = 'sonar-pro';
export type SonarDeepResearch = 'sonar-deep-research';

// Category types composed from individual types
export type ImageModel = GPTImage1 | Gemini25FlashImage;
export type ResearchModel = Gemini25Pro | Gemini25Flash | ClaudeOpus45 | ClaudeSonnet45 | O4MiniDeepResearch | GPT52 | Sonar | SonarPro | SonarDeepResearch;
export type ValidationModel = ClaudeHaiku35 | Gemini20Flash | GPT4oMini | Sonar;
export type FastModel = Gemini25Flash | Gemini20Flash;
export type GenericModel = Gemini25Pro | GPT52;

// Union of all models
export type LLMModel = Gemini25Pro | Gemini25Flash | Gemini20Flash | Gemini25FlashImage | O4MiniDeepResearch | GPT52 | GPT4oMini | GPTImage1 | ClaudeOpus45 | ClaudeSonnet45 | ClaudeHaiku35 | Sonar | SonarPro | SonarDeepResearch;
```

### 2. Constants Objects

```typescript
// Provider constants
export type Google = 'google';
export type OpenAI = 'openai';
export type Anthropic = 'anthropic';
export type Perplexity = 'perplexity';

export type LlmProvider = Google | OpenAI | Anthropic | Perplexity;

export const LlmProviders = {
  Google: 'google' as Google,
  OpenAI: 'openai' as OpenAI,
  Anthropic: 'anthropic' as Anthropic,
  Perplexity: 'perplexity' as Perplexity,
} as const;

// Model constants
export const LlmModels = {
  // Google
  Gemini25Pro: 'gemini-2.5-pro' as Gemini25Pro,
  Gemini25Flash: 'gemini-2.5-flash' as Gemini25Flash,
  Gemini20Flash: 'gemini-2.0-flash' as Gemini20Flash,
  Gemini25FlashImage: 'gemini-2.5-flash-image' as Gemini25FlashImage,
  // OpenAI
  O4MiniDeepResearch: 'o4-mini-deep-research' as O4MiniDeepResearch,
  GPT52: 'gpt-5.2' as GPT52,
  GPT4oMini: 'gpt-4o-mini' as GPT4oMini,
  GPTImage1: 'gpt-image-1' as GPTImage1,
  // Anthropic
  ClaudeOpus45: 'claude-opus-4-5-20251101' as ClaudeOpus45,
  ClaudeSonnet45: 'claude-sonnet-4-5-20250929' as ClaudeSonnet45,
  ClaudeHaiku35: 'claude-3-5-haiku-20241022' as ClaudeHaiku35,
  // Perplexity
  Sonar: 'sonar' as Sonar,
  SonarPro: 'sonar-pro' as SonarPro,
  SonarDeepResearch: 'sonar-deep-research' as SonarDeepResearch,
} as const;
```

### 3. Naming Convention

- Type aliases: PascalCase matching the constant name (e.g., `Gemini25Pro`)
- Constants objects: `LlmModels` and `LlmProviders` (camelCase `Llm` prefix)
- Individual constants: PascalCase (e.g., `LlmModels.Gemini25Pro`)

### 4. Exclusions from Verification

- `packages/llm-contract/` - single source of truth for string definitions
- `migrations/*.mjs` - historical records, strings required for database operations

### 5. No Backward Compatibility

- Remove `SupportedModel` type alias completely
- Remove `SYSTEM_DEFAULT_MODELS` constant completely
- All consumers must migrate to new types

---

## Executable Tasks

Each task is a discrete unit of work. Complete in order. Run `npm run typecheck` after each task to validate.

### Task Overview

| Task | Description | Depends On | Est. Violations |
|------|-------------|------------|-----------------|
| [TASK-01](./tasks/TASK-01-llm-contract-types.md) | Add individual model/provider types to llm-contract | - | 0 |
| [TASK-02](./tasks/TASK-02-llm-contract-constants.md) | Add LlmModels and LlmProviders constants | TASK-01 | 0 |
| [TASK-03](./tasks/TASK-03-remove-deprecated.md) | Remove SupportedModel and SYSTEM_DEFAULT_MODELS | TASK-02 | 0 |
| [TASK-04](./tasks/TASK-04-llm-orchestrator-domain.md) | Migrate llm-orchestrator domain layer | TASK-03 | ~50 |
| [TASK-05](./tasks/TASK-05-llm-orchestrator-infra-routes.md) | Migrate llm-orchestrator infra and routes | TASK-04 | ~50 |
| [TASK-06](./tasks/TASK-06-commands-router.md) | Migrate commands-router app | TASK-03 | ~20 |
| [TASK-07](./tasks/TASK-07-actions-agent.md) | Migrate actions-agent app | TASK-03 | ~5 |
| [TASK-08](./tasks/TASK-08-image-service.md) | Migrate image-service app | TASK-02 | ~30 |
| [TASK-09](./tasks/TASK-09-data-insights-service.md) | Migrate data-insights-service app | TASK-02 | ~5 |
| [TASK-10](./tasks/TASK-10-user-service.md) | Migrate user-service app | TASK-02 | ~5 |
| [TASK-11](./tasks/TASK-11-app-settings-service.md) | Migrate app-settings-service app | TASK-02 | ~15 |
| [TASK-12](./tasks/TASK-12-llm-pricing.md) | Migrate llm-pricing package | TASK-02 | ~20 |
| [TASK-13](./tasks/TASK-13-infra-packages.md) | Migrate infra-* packages | TASK-02 | ~10 |
| [TASK-14](./tasks/TASK-14-web-app.md) | Migrate web app | TASK-02 | ~50 |
| [TASK-15](./tasks/TASK-15-test-files.md) | Migrate all test files | TASK-04-14 | ~600 |
| [TASK-16](./tasks/TASK-16-enable-ci-verification.md) | Enable verification in CI | All | 0 |

### Execution Order

```
TASK-01 → TASK-02 → TASK-03 ─┬─→ TASK-04 → TASK-05 ──┐
                             ├─→ TASK-06 ────────────┤
                             ├─→ TASK-07 ────────────┤
                             ├─→ TASK-08 ────────────┤
                             ├─→ TASK-09 ────────────┤
                             ├─→ TASK-10 ────────────┼─→ TASK-15 → TASK-16
                             ├─→ TASK-11 ────────────┤
                             ├─→ TASK-12 ────────────┤
                             ├─→ TASK-13 ────────────┤
                             └─→ TASK-14 ────────────┘
```

### Progress Tracking

After completing each task, run verification:

```bash
npx tsx scripts/verify-llm-architecture.ts 2>&1 | grep "Summary" -A 10
```

---

## Removals Summary

| Item | Location | Action |
|------|----------|--------|
| `SupportedModel` type | `llm-contract/supportedModels.ts` | **DELETE** |
| `SupportedModel` export | `llm-contract/index.ts` | **DELETE** |
| `SYSTEM_DEFAULT_MODELS` | `llm-contract/supportedModels.ts` | **DELETE** |
| `SYSTEM_DEFAULT_MODELS` export | `llm-contract/index.ts` | **DELETE** |

---

## Final Verification

After all tasks complete:

```bash
# Full CI must pass
npm run ci

# Verification script must show 0 violations
npx tsx scripts/verify-llm-architecture.ts

# Expected output:
# All checks passed! No violations found.
```

---

## Reference Files

- [violations-baseline.txt](./violations-baseline.txt) - Full list of 1060 violations before migration
- [tasks/](./tasks/) - Individual task files with detailed instructions

### Phase 1: Update llm-contract Package

**Files to modify:**

1. **`packages/llm-contract/src/supportedModels.ts`**
   - Add individual model type aliases (14 types)
   - Add individual provider type aliases (4 types)
   - Update category types to use individual types
   - Add `LlmModels` constants object
   - Add `LlmProviders` constants object
   - Update `MODEL_PROVIDER_MAP` to use constants
   - Update `ALL_LLM_MODELS` to use constants
   - Remove deprecated `SupportedModel` type
   - Remove deprecated `SYSTEM_DEFAULT_MODELS` constant

2. **`packages/llm-contract/src/index.ts`**
   - Export `LlmModels` and `LlmProviders` objects
   - Export all individual model types
   - Export all individual provider types
   - Remove `SupportedModel` export
   - Remove `SYSTEM_DEFAULT_MODELS` export

### Phase 2: Update llm-orchestrator App (Largest - ~300 violations)

**Domain layer files:**

| File | Changes |
|------|---------|
| `src/domain/research/models/Research.ts` | Replace `SupportedModel` → `ResearchModel`, remove re-export |
| `src/domain/research/models/index.ts` | Update exports |
| `src/domain/research/usecases/submitResearch.ts` | Update types |
| `src/domain/research/usecases/processResearch.ts` | Update types, use `LlmModels` |
| `src/domain/research/usecases/checkLlmCompletion.ts` | Update types |
| `src/domain/research/usecases/enhanceResearch.ts` | Update types |
| `src/domain/research/usecases/retryFailedLlms.ts` | Update types |
| `src/domain/research/usecases/retryFromFailed.ts` | Update types |
| `src/domain/research/usecases/runSynthesis.ts` | Update types |

**Infrastructure layer files:**

| File | Changes |
|------|---------|
| `src/infra/pubsub/llmCallPublisher.ts` | Update types |
| `src/infra/llm/LlmAdapterFactory.ts` | Replace string checks with `LlmModels`/`LlmProviders` |
| `src/infra/llm/GeminiAdapter.ts` | Use `LlmProviders.Google` |
| `src/infra/llm/GptAdapter.ts` | Use `LlmProviders.OpenAI` |
| `src/infra/llm/ClaudeAdapter.ts` | Use `LlmProviders.Anthropic` |
| `src/infra/llm/PerplexityAdapter.ts` | Use `LlmProviders.Perplexity` |

**Routes layer files:**

| File | Changes |
|------|---------|
| `src/routes/researchRoutes.ts` | Update types, replace model strings with constants |
| `src/routes/internalRoutes.ts` | Update types |
| `src/index.ts` | Replace `REQUIRED_MODELS` strings with constants |

**Test files (~200 violations):**

| File | Violations (approx) |
|------|---------------------|
| `__tests__/domain/research/usecases/checkLlmCompletion.test.ts` | 50+ |
| `__tests__/domain/research/usecases/processResearch.test.ts` | 40+ |
| `__tests__/domain/research/usecases/retryFailedLlms.test.ts` | 30+ |
| `__tests__/domain/research/usecases/retryFromFailed.test.ts` | 30+ |
| `__tests__/domain/research/usecases/runSynthesis.test.ts` | 40+ |
| `__tests__/domain/research/usecases/enhanceResearch.test.ts` | 25+ |
| `__tests__/domain/research/utils/costCalculator.test.ts` | 10+ |
| `__tests__/domain/research/utils/htmlGenerator.test.ts` | 10+ |
| `__tests__/fakes.ts` | 5+ |
| `__tests__/routes.test.ts` | 20+ |

### Phase 3: Update commands-router App (~70 violations)

**Source files:**

| File | Changes |
|------|---------|
| `src/domain/events/actionCreatedEvent.ts` | Replace `SupportedModel` → `ResearchModel` |
| `src/domain/ports/classifier.ts` | Update types |
| `src/infra/gemini/classifier.ts` | Replace `MODEL_KEYWORDS` keys/values, `DEFAULT_MODELS`, `CLASSIFIER_MODEL` |

**Test files:**

| File | Violations (approx) |
|------|---------------------|
| `__tests__/infra/classifier.test.ts` | 30+ |
| `__tests__/infra/pubsub/actionEventPublisher.test.ts` | 10+ |
| `__tests__/routes.test.ts` | 15+ |
| `__tests__/usecases/retryPendingCommands.test.ts` | 5+ |

### Phase 4: Update actions-agent App (~15 violations)

| File | Changes |
|------|---------|
| `src/domain/models/actionEvent.ts` | Replace `SupportedModel` → `ResearchModel` |
| `src/domain/ports/researchServiceClient.ts` | Update types |
| `src/domain/usecases/executeResearchAction.ts` | Replace `'claude-opus-4-5-20251101'` → `LlmModels.ClaudeOpus45` |
| `src/infra/research/llmOrchestratorClient.ts` | Update types |
| `__tests__/infra/research/llmOrchestratorClient.test.ts` | Replace model strings |

### Phase 5: Update image-service App (~100 violations)

**Source files:**

| File | Changes |
|------|---------|
| `src/domain/models/ImageGenerationModel.ts` | Use individual model types |
| `src/domain/models/ImagePromptModel.ts` | Use individual model types |
| `src/index.ts` | Replace `REQUIRED_MODELS` with constants |
| `src/services.ts` | Use `LlmModels` for pricing lookups |
| `src/infra/llm/GeminiPromptAdapter.ts` | Use `LlmModels.Gemini25Pro` |
| `src/infra/image/GoogleImageGenerator.ts` | Use `LlmModels.Gemini25FlashImage` |
| `src/routes/schemas/imageSchemas.ts` | Update enum values |
| `src/routes/schemas/promptSchemas.ts` | Update enum values |

**Test files:**

| File | Violations (approx) |
|------|---------------------|
| `__tests__/FakeImageGenerator.test.ts` | 10+ |
| `__tests__/GeminiPromptAdapter.test.ts` | 5+ |
| `__tests__/infra/GoogleImageGenerator.test.ts` | 15+ |
| `__tests__/infra/OpenAIImageGenerator.test.ts` | 15+ |
| `__tests__/infra/firestore/generatedImageRepository.test.ts` | 5+ |
| `__tests__/internalRoutes.test.ts` | 20+ |
| `__tests__/models.test.ts` | 15+ |
| `__tests__/services.test.ts` | 5+ |
| `__tests__/fakes.ts` | 3+ |

### Phase 6: Update data-insights-service App (~5 violations)

| File | Changes |
|------|---------|
| `src/index.ts` | Replace model string in `REQUIRED_MODELS` |
| `src/infra/gemini/feedNameGenerationService.ts` | Use `LlmModels.Gemini25Flash` |
| `src/infra/gemini/titleGenerationService.ts` | Use `LlmModels.Gemini25Flash` |

### Phase 7: Update user-service App (~5 violations)

| File | Changes |
|------|---------|
| `src/index.ts` | Replace model strings in `REQUIRED_MODELS` |
| `src/infra/llm/LlmValidatorImpl.ts` | Use `LlmProviders` constants |

### Phase 8: Update app-settings-service App (~30 violations)

**Source files:**

| File | Changes |
|------|---------|
| `src/index.ts` | Use `LlmProviders` for iteration |
| `src/routes/internalRoutes.ts` | Use `LlmProviders` for iteration |
| `src/infra/firestore/firestorePricingRepository.ts` | Use `LlmProviders` constants |

**Test files:**

| File | Violations (approx) |
|------|---------------------|
| `__tests__/infra/FirestorePricingRepository.test.ts` | 5+ |
| `__tests__/routes/internalRoutes.test.ts` | 10+ |

### Phase 9: Update llm-pricing Package (~50 violations)

| File | Changes |
|------|---------|
| `src/pricingClient.ts` | Use `LlmProviders` for iteration |
| `src/testFixtures.ts` | Use `LlmModels` constants |
| `__tests__/pricingClient.test.ts` | Use `LlmModels` constants |

### Phase 10: Update Infrastructure Packages (~20 violations)

| File | Changes |
|------|---------|
| `packages/infra-gemini/src/geminiClient.ts` | Use `LlmProviders.Google` |
| `packages/infra-gpt/src/gptClient.ts` | Use `LlmProviders.OpenAI` |
| `packages/infra-claude/src/claudeClient.ts` | Use `LlmProviders.Anthropic` |
| `packages/infra-perplexity/src/perplexityClient.ts` | Use `LlmProviders.Perplexity` |

### Phase 11: Update Web App (~50+ violations)

Scan `apps/web/src/**/*.tsx` and `apps/web/src/**/*.ts` for:
- Model string usage in research forms
- Provider string usage in model selection UI
- Any hardcoded strings in type definitions

---

## Removals Summary

| Item | Location | Action |
|------|----------|--------|
| `SupportedModel` type | `llm-contract/supportedModels.ts` | **DELETE** |
| `SupportedModel` export | `llm-contract/index.ts` | **DELETE** |
| `SYSTEM_DEFAULT_MODELS` | `llm-contract/supportedModels.ts` | **DELETE** |
| `SYSTEM_DEFAULT_MODELS` export | `llm-contract/index.ts` | **DELETE** |
| All `'gemini-*'` strings | Entire codebase except `llm-contract` | Replace with `LlmModels.*` |
| All `'gpt-*'` strings | Entire codebase except `llm-contract` | Replace with `LlmModels.*` |
| All `'claude-*'` strings | Entire codebase except `llm-contract` | Replace with `LlmModels.*` |
| All `'sonar*'` strings | Entire codebase except `llm-contract` | Replace with `LlmModels.*` |
| All `'o4-*'` strings | Entire codebase except `llm-contract` | Replace with `LlmModels.*` |
| All `'google'` (LLM context) | Entire codebase except `llm-contract` | Replace with `LlmProviders.Google` |
| All `'openai'` (LLM context) | Entire codebase except `llm-contract` | Replace with `LlmProviders.OpenAI` |
| All `'anthropic'` strings | Entire codebase except `llm-contract` | Replace with `LlmProviders.Anthropic` |
| All `'perplexity'` strings | Entire codebase except `llm-contract` | Replace with `LlmProviders.Perplexity` |

---

## Verification

After migration, run:

```bash
npm run verify:llm-architecture
```

Expected output:
```
=== LLM Architecture Verification ===

Rule 1: Checking for unauthorized LLMClient implementations...
Rule 2: Checking if clients log usage...
Rule 3: Checking for hardcoded cost values in apps/...
Rule 4: Checking for hardcoded model strings...
Rule 5: Checking for hardcoded provider strings...
All checks passed! No violations found.
```

---

## Completion Criteria

- [ ] `packages/llm-contract/src/supportedModels.ts` updated with typed constants
- [ ] `SupportedModel` and `SYSTEM_DEFAULT_MODELS` removed
- [ ] All 703 RULE-4 violations fixed (hardcoded model strings)
- [ ] All 357 RULE-5 violations fixed (hardcoded provider strings)
- [ ] `npm run ci` passes
- [ ] `npm run verify:llm-architecture` shows 0 violations
- [ ] All tests pass with new constants

---

## Files Summary by Violation Count

| App/Package | Approx Violations | Files to Change |
|-------------|-------------------|-----------------|
| llm-orchestrator | ~300 | ~25 files |
| image-service | ~100 | ~15 files |
| commands-router | ~70 | ~8 files |
| llm-pricing | ~50 | ~3 files |
| web | ~50+ | TBD |
| app-settings-service | ~30 | ~5 files |
| infra-* packages | ~20 | ~4 files |
| actions-agent | ~15 | ~5 files |
| user-service | ~5 | ~2 files |
| data-insights-service | ~5 | ~3 files |
| **Total** | **~1060** | **~70+ files** |

