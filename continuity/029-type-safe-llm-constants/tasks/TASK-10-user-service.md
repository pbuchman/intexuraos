# TASK-10: Migrate user-service App

## Status: PENDING

## Depends On: TASK-02

## Objective

Replace hardcoded model and provider strings with constants in user-service.

## Files to Modify

### 1. `apps/user-service/src/index.ts`

**Update REQUIRED_MODELS:**
```typescript
import { LlmModels, type ValidationModel } from '@intexuraos/llm-contract';

// Locate REQUIRED_MODELS and replace string literals:
// FROM:
const REQUIRED_MODELS: ValidationModel[] = ['gemini-2.0-flash', 'gpt-4o-mini', 'claude-3-5-haiku-20241022'];

// TO:
const REQUIRED_MODELS: ValidationModel[] = [
  LlmModels.Gemini20Flash,
  LlmModels.GPT4oMini,
  LlmModels.ClaudeHaiku35,
];
```

### 2. `apps/user-service/src/infra/llm/LlmValidatorImpl.ts`

**Update provider strings:**
```typescript
import { LlmProviders } from '@intexuraos/llm-contract';

// Replace any occurrences of:
// 'google' → LlmProviders.Google
// 'openai' → LlmProviders.OpenAI
// 'anthropic' → LlmProviders.Anthropic
```

## Validation

```bash
npm run typecheck -w @intexuraos/user-service
```

## Acceptance Criteria

- [ ] No hardcoded model strings
- [ ] No hardcoded provider strings
- [ ] Typecheck passes

