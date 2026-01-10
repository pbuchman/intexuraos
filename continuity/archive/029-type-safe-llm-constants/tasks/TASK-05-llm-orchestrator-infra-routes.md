# TASK-05: Migrate research-agent Infra and Routes Layer

## Status: ✅ COMPLETED

## Depends On: TASK-04

## Objective

Replace `SupportedModel` with `ResearchModel` in research-agent infra and routes. Replace hardcoded model/provider strings with constants.

## Files to Modify

### 1. `apps/research-agent/src/infra/pubsub/llmCallPublisher.ts`

**Update import and types:**

```typescript
// FROM:
import type { SupportedModel } from '../../domain/research/models/Research.js';

// TO:
import type { ResearchModel } from '../../domain/research/models/Research.js';
```

**Replace type usage:**

- Line 9: `model: SupportedModel` → `model: ResearchModel`

### 2. `apps/research-agent/src/infra/llm/LlmAdapterFactory.ts`

**Add import:**

```typescript
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';
```

**Replace string checks with constants (example pattern):**

```typescript
// FROM:
case 'gemini-2.5-pro':
case 'gemini-2.5-flash':

// TO:
case LlmModels.Gemini25Pro:
case LlmModels.Gemini25Flash:
```

### 3. `apps/research-agent/src/infra/llm/GeminiAdapter.ts`

**Add import and use constant:**

```typescript
import { LlmProviders } from '@intexuraos/llm-contract';

// Replace:
provider: 'google',
// With:
provider: LlmProviders.Google,
```

### 4. `apps/research-agent/src/infra/llm/GptAdapter.ts`

**Add import and use constant:**

```typescript
import { LlmProviders } from '@intexuraos/llm-contract';

// Replace:
provider: 'openai',
// With:
provider: LlmProviders.OpenAI,
```

### 5. `apps/research-agent/src/infra/llm/ClaudeAdapter.ts`

**Add import and use constant:**

```typescript
import { LlmProviders } from '@intexuraos/llm-contract';

// Replace:
provider: 'anthropic',
// With:
provider: LlmProviders.Anthropic,
```

### 6. `apps/research-agent/src/infra/llm/PerplexityAdapter.ts`

**Add import and use constant:**

```typescript
import { LlmProviders } from '@intexuraos/llm-contract';

// Replace:
provider: 'perplexity',
// With:
provider: LlmProviders.Perplexity,
```

### 7. `apps/research-agent/src/routes/researchRoutes.ts`

**Update import:**

```typescript
// FROM:
import { type SupportedModel, ... } from '@intexuraos/llm-contract';

// TO:
import { type ResearchModel, LlmModels, ... } from '@intexuraos/llm-contract';
```

**Replace type usages:**

- Line 58: `selectedModels: SupportedModel[]` → `selectedModels: ResearchModel[]`
- Line 59: `synthesisModel?: SupportedModel` → `synthesisModel?: ResearchModel`
- Line 66-67: Same pattern
- Line 85, 87: Same pattern

**Replace hardcoded default models (line ~245):**

```typescript
// FROM:
const defaultModels: SupportedModel[] = [
  'gemini-2.5-pro',
  'claude-opus-4-5-20251101',
  'o4-mini-deep-research',
  'gpt-5.2',
  'sonar-pro',
];

// TO:
const defaultModels: ResearchModel[] = [
  LlmModels.Gemini25Pro,
  LlmModels.ClaudeOpus45,
  LlmModels.O4MiniDeepResearch,
  LlmModels.GPT52,
  LlmModels.SonarPro,
];
```

### 8. `apps/research-agent/src/routes/internalRoutes.ts`

**Update import:**

```typescript
// FROM:
import { type SupportedModel, ... } from '@intexuraos/llm-contract';

// TO:
import { type ResearchModel, ... } from '@intexuraos/llm-contract';
```

**Replace type usages:**

- Line 28: `selectedModels: SupportedModel[]` → `selectedModels: ResearchModel[]`
- Line 52: `model: SupportedModel` → `model: ResearchModel`
- Line 62: `model: SupportedModel` → `model: ResearchModel`

### 9. `apps/research-agent/src/index.ts`

**Update REQUIRED_MODELS:**

```typescript
import { LlmModels, type ResearchModel, type FastModel } from '@intexuraos/llm-contract';

const REQUIRED_MODELS: (ResearchModel | FastModel)[] = [
  // Research models
  LlmModels.Gemini25Pro,
  LlmModels.Gemini25Flash,
  LlmModels.ClaudeOpus45,
  LlmModels.ClaudeSonnet45,
  LlmModels.O4MiniDeepResearch,
  LlmModels.GPT52,
  LlmModels.Sonar,
  LlmModels.SonarPro,
  LlmModels.SonarDeepResearch,
  // Fast models for title generation
  LlmModels.Gemini20Flash,
];
```

## Validation

```bash
npm run typecheck -w @intexuraos/research-agent
```

## Acceptance Criteria

- [ ] No `SupportedModel` references in infra or routes
- [ ] No hardcoded model strings (use `LlmModels.*`)
- [ ] No hardcoded provider strings (use `LlmProviders.*`)
- [ ] Typecheck passes
