# TASK-04: Migrate research-agent Domain Layer

## Status: ✅ COMPLETED

## Depends On: TASK-03

## Objective

Replace all `SupportedModel` usages with `ResearchModel` in research-agent domain layer. Replace hardcoded model strings with `LlmModels` constants.

## Files to Modify

### 1. `apps/research-agent/src/domain/research/models/Research.ts`

**Change import (line ~9):**

```typescript
// FROM:
import {
  getProviderForModel,
  type LlmProvider,
  type SupportedModel,
} from '@intexuraos/llm-contract';

// TO:
import {
  getProviderForModel,
  type LlmProvider,
  type ResearchModel,
  LlmModels,
} from '@intexuraos/llm-contract';
```

**Remove re-export (line ~13):**

```typescript
// DELETE:
export type { SupportedModel } from '@intexuraos/llm-contract';
```

**Replace all `SupportedModel` with `ResearchModel`:**

- Line 29: `failedModels: SupportedModel[]` → `failedModels: ResearchModel[]`
- Line 81: `selectedModels: SupportedModel[]` → `selectedModels: ResearchModel[]`
- Line 82: `synthesisModel: SupportedModel` → `synthesisModel: ResearchModel`
- Line 102: `function createLlmResults(selectedModels: SupportedModel[])` → `ResearchModel[]`
- Line 114-115: `createResearch` params
- Line 158-159: `createDraftResearch` params
- Line 191, 193: `EnhanceResearchParams` fields
- Line 211: cast `as SupportedModel` → `as ResearchModel`

### 2. `apps/research-agent/src/domain/research/models/index.ts`

**Change re-export (line 12):**

```typescript
// FROM:
type SupportedModel,

// TO:
type ResearchModel,
```

### 3. `apps/research-agent/src/domain/research/usecases/submitResearch.ts`

**Update import and types:**

```typescript
// FROM:
import { createResearch, type Research, type SupportedModel } from '../models/index.js';

// TO:
import { createResearch, type Research, type ResearchModel } from '../models/index.js';
```

**Replace type usages:**

- Line 13: `selectedModels: SupportedModel[]` → `selectedModels: ResearchModel[]`
- Line 14: `synthesisModel: SupportedModel` → `synthesisModel: ResearchModel`

### 4. `apps/research-agent/src/domain/research/usecases/processResearch.ts`

**Update import:**

```typescript
// FROM:
import type { SupportedModel } from '../models/index.js';

// TO:
import type { ResearchModel } from '../models/index.js';
```

**Replace type usages:**

- Line 23: `model: SupportedModel` → `model: ResearchModel`
- Line 35: `reportLlmSuccess?: (model: SupportedModel) => void` → `ResearchModel`
- Line 62: `const titleModel: SupportedModel` → `ResearchModel`
- Line 105: `as SupportedModel` → `as ResearchModel`

### 5. `apps/research-agent/src/domain/research/usecases/checkLlmCompletion.ts`

**Update import and types:**

```typescript
// FROM:
import type { SupportedModel } from '../models/index.js';

// TO:
import type { ResearchModel } from '../models/index.js';
```

**Replace type usages:**

- Line 14: `failedModels: SupportedModel[]` → `failedModels: ResearchModel[]`
- Line 33: `as SupportedModel` → `as ResearchModel`
- Line 56: `as SupportedModel` → `as ResearchModel`

### 6. `apps/research-agent/src/domain/research/usecases/enhanceResearch.ts`

**Update import and types:**

```typescript
// FROM:
import { createEnhancedResearch, type Research, type SupportedModel } from '../models/index.js';

// TO:
import { createEnhancedResearch, type Research, type ResearchModel } from '../models/index.js';
```

**Replace type usages:**

- Line 14: `additionalModels?: SupportedModel[]` → `ResearchModel[]`
- Line 16: `synthesisModel?: SupportedModel` → `ResearchModel`

### 7. `apps/research-agent/src/domain/research/usecases/retryFailedLlms.ts`

**Update import and types:**

```typescript
// FROM:
import type { SupportedModel } from '../models/index.js';

// TO:
import type { ResearchModel } from '../models/index.js';
```

**Replace type usages:**

- Line 19: `model: SupportedModel` → `model: ResearchModel`
- Line 32: `retriedModels?: SupportedModel[]` → `ResearchModel[]`

### 8. `apps/research-agent/src/domain/research/usecases/retryFromFailed.ts`

**Update import and types:**

```typescript
// FROM:
import type { SupportedModel } from '../models/index.js';

// TO:
import type { ResearchModel } from '../models/index.js';
```

**Replace type usages:**

- Line 19: `model: SupportedModel` → `model: ResearchModel`
- Line 36: `retriedModels?: SupportedModel[]` → `ResearchModel[]`
- Line 66: `as SupportedModel` → `as ResearchModel`

## Validation

```bash
npm run typecheck -w @intexuraos/research-agent
```

## Acceptance Criteria

- [ ] No `SupportedModel` references in domain layer
- [ ] All domain files use `ResearchModel` type
- [ ] Typecheck passes for research-agent
