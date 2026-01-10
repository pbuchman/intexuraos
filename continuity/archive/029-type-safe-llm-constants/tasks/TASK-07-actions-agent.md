# TASK-07: Migrate actions-agent App

## Status: ✅ COMPLETED

## Depends On: TASK-03

## Objective

Replace `SupportedModel` with `ResearchModel` and replace hardcoded model strings with `LlmModels` constants in actions-agent.

## Files to Modify

### 1. `apps/actions-agent/src/domain/models/actionEvent.ts`

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

### 2. `apps/actions-agent/src/domain/ports/researchServiceClient.ts`

**Update import and type:**

```typescript
// FROM:
import type { SupportedModel } from '@intexuraos/llm-contract';

// TO:
import type { ResearchModel } from '@intexuraos/llm-contract';

// Line 9:
// FROM:
selectedModels: SupportedModel[];

// TO:
selectedModels: ResearchModel[];
```

### 3. `apps/actions-agent/src/domain/usecases/executeResearchAction.ts`

**Add import and replace hardcoded model:**

```typescript
// Add import:
import { LlmModels, type ResearchModel } from '@intexuraos/llm-contract';

// Line 56 - FROM:
const selectedModels: SupportedModel[] = ['claude-opus-4-5-20251101'];

// TO:
const selectedModels: ResearchModel[] = [LlmModels.ClaudeOpus45];
```

### 4. `apps/actions-agent/src/infra/research/ResearchAgentClient.ts`

**Update import and type:**

```typescript
// FROM:
import type { SupportedModel } from '@intexuraos/llm-contract';

// TO:
import type { ResearchModel } from '@intexuraos/llm-contract';

// Line 35:
// FROM:
selectedModels: SupportedModel[];

// TO:
selectedModels: ResearchModel[];
```

## Validation

```bash
npm run typecheck -w @intexuraos/actions-agent
```

## Acceptance Criteria

- [ ] No `SupportedModel` references
- [ ] Default model uses `LlmModels.ClaudeOpus45` instead of string
- [ ] Typecheck passes
