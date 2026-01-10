# TASK-09: Migrate data-insights-service App

## Status: PENDING

## Depends On: TASK-02

## Objective

Replace hardcoded model strings with `LlmModels` constants in data-insights-service.

## Files to Modify

### 1. `apps/data-insights-service/src/index.ts`

**Update REQUIRED_MODELS:**

```typescript
import { LlmModels, type FastModel } from '@intexuraos/llm-contract';

// FROM:
const REQUIRED_MODELS = ['gemini-2.5-flash'] as const;

// TO:
const REQUIRED_MODELS: FastModel[] = [LlmModels.Gemini25Flash];
```

### 2. `apps/data-insights-service/src/infra/gemini/feedNameGenerationService.ts`

**Update model constant:**

```typescript
import { LlmModels, type FastModel } from '@intexuraos/llm-contract';

// FROM:
const NAME_GENERATION_MODEL: FastModel = 'gemini-2.5-flash';

// TO:
const NAME_GENERATION_MODEL: FastModel = LlmModels.Gemini25Flash;
```

### 3. `apps/data-insights-service/src/infra/gemini/titleGenerationService.ts`

**Update model constant:**

```typescript
import { LlmModels, type FastModel } from '@intexuraos/llm-contract';

// FROM:
const TITLE_GENERATION_MODEL: FastModel = 'gemini-2.5-flash';

// TO:
const TITLE_GENERATION_MODEL: FastModel = LlmModels.Gemini25Flash;
```

## Validation

```bash
npm run typecheck -w @intexuraos/data-insights-service
```

## Acceptance Criteria

- [ ] No hardcoded model strings
- [ ] All model references use `LlmModels.*`
- [ ] Typecheck passes
