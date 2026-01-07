# TASK-06: Migrate commands-router App

## Status: ✅ COMPLETED

## Depends On: TASK-03

## Objective

Replace `SupportedModel` with `ResearchModel` and replace hardcoded model strings with `LlmModels` constants in commands-router.

## Files to Modify

### 1. `apps/commands-router/src/domain/events/actionCreatedEvent.ts`

**Update import and type:**
```typescript
// FROM:
import type { SupportedModel } from '@intexuraos/llm-contract';

// TO:
import type { ResearchModel } from '@intexuraos/llm-contract';

// Line 14:
// FROM:
selectedModels?: SupportedModel[];

// TO:
selectedModels?: ResearchModel[];
```

### 2. `apps/commands-router/src/domain/ports/classifier.ts`

**Update import and type:**
```typescript
// FROM:
import type { SupportedModel } from '@intexuraos/llm-contract';

// TO:
import type { ResearchModel } from '@intexuraos/llm-contract';

// Line 9:
// FROM:
selectedModels?: SupportedModel[];

// TO:
selectedModels?: ResearchModel[];
```

### 3. `apps/commands-router/src/infra/gemini/classifier.ts`

**Update imports:**
```typescript
// FROM:
import type { ModelPricing, SupportedModel } from '@intexuraos/llm-contract';

// TO:
import { LlmModels, type ModelPricing, type ResearchModel } from '@intexuraos/llm-contract';
```

**Replace MODEL_KEYWORDS (lines 50-60):**
```typescript
// FROM:
const MODEL_KEYWORDS: Record<SupportedModel, string[]> = {
  'gemini-2.5-pro': ['gemini pro', 'gemini-pro'],
  'gemini-2.5-flash': ['gemini flash', 'gemini-flash', 'gemini', 'google'],
  'claude-opus-4-5-20251101': ['claude opus', 'opus'],
  'claude-sonnet-4-5-20250929': ['claude sonnet', 'sonnet', 'claude', 'anthropic'],
  'o4-mini-deep-research': ['o4', 'o4-mini', 'deep research'],
  'gpt-5.2': ['gpt', 'gpt-5', 'openai', 'chatgpt'],
  sonar: ['sonar basic'],
  'sonar-pro': ['sonar', 'sonar pro', 'pplx', 'perplexity'],
  'sonar-deep-research': ['sonar deep', 'perplexity deep', 'deep sonar'],
};

// TO:
const MODEL_KEYWORDS: Record<ResearchModel, string[]> = {
  [LlmModels.Gemini25Pro]: ['gemini pro', 'gemini-pro'],
  [LlmModels.Gemini25Flash]: ['gemini flash', 'gemini-flash', 'gemini', 'google'],
  [LlmModels.ClaudeOpus45]: ['claude opus', 'opus'],
  [LlmModels.ClaudeSonnet45]: ['claude sonnet', 'sonnet', 'claude', 'anthropic'],
  [LlmModels.O4MiniDeepResearch]: ['o4', 'o4-mini', 'deep research'],
  [LlmModels.GPT52]: ['gpt', 'gpt-5', 'openai', 'chatgpt'],
  [LlmModels.Sonar]: ['sonar basic'],
  [LlmModels.SonarPro]: ['sonar', 'sonar pro', 'pplx', 'perplexity'],
  [LlmModels.SonarDeepResearch]: ['sonar deep', 'perplexity deep', 'deep sonar'],
};
```

**Replace DEFAULT_MODELS (lines 62-68):**
```typescript
// FROM:
const DEFAULT_MODELS: SupportedModel[] = [
  'gemini-2.5-pro',
  'claude-opus-4-5-20251101',
  'gpt-5.2',
  'sonar-pro',
];

// TO:
const DEFAULT_MODELS: ResearchModel[] = [
  LlmModels.Gemini25Pro,
  LlmModels.ClaudeOpus45,
  LlmModels.GPT52,
  LlmModels.SonarPro,
];
```

**Replace CLASSIFIER_MODEL (line ~104):**
```typescript
// FROM:
const CLASSIFIER_MODEL = 'gemini-2.5-flash';

// TO:
const CLASSIFIER_MODEL = LlmModels.Gemini25Flash;
```

**Update extractSelectedModels return type (line 82):**
```typescript
// FROM:
export function extractSelectedModels(text: string): SupportedModel[] | undefined {

// TO:
export function extractSelectedModels(text: string): ResearchModel[] | undefined {
```

**Update casts (lines 91-92):**
```typescript
// FROM:
for (const [model, keywords] of Object.entries(MODEL_KEYWORDS) as [SupportedModel, string[]][]) {

// TO:
for (const [model, keywords] of Object.entries(MODEL_KEYWORDS) as [ResearchModel, string[]][]) {
```

## Validation

```bash
npm run typecheck -w @intexuraos/commands-router
```

## Acceptance Criteria

- [ ] No `SupportedModel` references
- [ ] `MODEL_KEYWORDS` uses `LlmModels` constants as keys
- [ ] `DEFAULT_MODELS` uses `LlmModels` constants
- [ ] `CLASSIFIER_MODEL` uses `LlmModels.Gemini25Flash`
- [ ] Typecheck passes

