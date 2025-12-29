# Task 3-3: Implement Research Usecases

**Tier:** 3 (Depends on 3-0, 3-1, 3-2)

---

## Context Snapshot

- Domain models defined (3-0)
- Ports (interfaces) defined (3-1)
- Synthesis config defined (3-2)
- Usecases orchestrate business logic using ports

**Working according to:** `.github/prompts/continuity.prompt.md`

---

## Problem Statement

Implement core usecases:

1. `submitResearch` — creates research and triggers async processing
2. `processResearch` — runs LLM calls, synthesis, notification
3. `getResearch` — retrieves single research by ID
4. `listResearches` — lists user's researches with pagination
5. `deleteResearch` — deletes a research

---

## Scope

**In scope:**

- Create usecase files in domain/research/usecases/
- Implement business logic using port interfaces
- Handle error cases with Result type
- Generate ID using crypto.randomUUID()

**Non-scope:**

- Actual port implementations (done in Tier 4)
- HTTP layer (done in Tier 5)

---

## Required Approach

### Step 1: Create usecases directory

```bash
mkdir -p apps/llm-orchestrator-service/src/domain/research/usecases
```

### Step 2: Create usecases/submitResearch.ts

```typescript
import { ok, err, type Result } from '@intexuraos/common-core';
import { createResearch, type Research, type LlmProvider } from '../models/index.js';
import type { ResearchRepository, RepositoryError } from '../ports/index.js';

export interface SubmitResearchParams {
  userId: string;
  prompt: string;
  selectedLlms: LlmProvider[];
}

export interface SubmitResearchDeps {
  researchRepo: ResearchRepository;
  generateId: () => string;
}

export async function submitResearch(
  params: SubmitResearchParams,
  deps: SubmitResearchDeps
): Promise<Result<Research, RepositoryError>> {
  const research = createResearch({
    id: deps.generateId(),
    userId: params.userId,
    prompt: params.prompt,
    selectedLlms: params.selectedLlms,
  });

  return await deps.researchRepo.save(research);
}
```

### Step 3: Create usecases/processResearch.ts

```typescript
import { isErr, type Result } from '@intexuraos/common-core';
import type { Research, LlmProvider } from '../models/index.js';
import type {
  ResearchRepository,
  LlmResearchProvider,
  LlmSynthesisProvider,
  NotificationSender,
} from '../ports/index.js';
import { buildSynthesisInput } from '../config/index.js';

export interface ProcessResearchDeps {
  researchRepo: ResearchRepository;
  llmProviders: Record<LlmProvider, LlmResearchProvider>;
  synthesizer: LlmSynthesisProvider;
  notificationSender: NotificationSender;
}

export async function processResearch(
  researchId: string,
  deps: ProcessResearchDeps
): Promise<void> {
  const researchResult = await deps.researchRepo.findById(researchId);
  if (isErr(researchResult) || researchResult.value === null) {
    return;
  }

  const research = researchResult.value;

  // Update status to processing
  await deps.researchRepo.update(researchId, { status: 'processing' });

  // Generate title
  const titleResult = await deps.synthesizer.generateTitle(research.prompt);
  if (!isErr(titleResult)) {
    await deps.researchRepo.update(researchId, { title: titleResult.value });
  }

  // Run LLM calls in parallel
  const llmPromises = research.selectedLlms.map(async (provider) => {
    const startedAt = new Date().toISOString();
    await deps.researchRepo.updateLlmResult(researchId, provider, {
      status: 'processing',
      startedAt,
    });

    const llmClient = deps.llmProviders[provider];
    const result = await llmClient.research(research.prompt);

    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - new Date(startedAt).getTime();

    if (isErr(result)) {
      await deps.researchRepo.updateLlmResult(researchId, provider, {
        status: 'failed',
        error: result.error.message,
        completedAt,
        durationMs,
      });
      return null;
    }

    await deps.researchRepo.updateLlmResult(researchId, provider, {
      status: 'completed',
      result: result.value.content,
      sources: result.value.sources,
      completedAt,
      durationMs,
    });

    return {
      provider,
      model: getModelName(provider),
      content: result.value.content,
    };
  });

  const llmResults = await Promise.all(llmPromises);
  const successfulResults = llmResults.filter((r) => r !== null);

  // Synthesize results
  if (successfulResults.length > 0) {
    const synthesisInput = buildSynthesisInput(
      research.prompt,
      successfulResults.map((r) => ({ model: r.model, content: r.content }))
    );

    const synthesisResult = await deps.synthesizer.synthesize(
      research.prompt,
      successfulResults.map((r) => ({ model: r.model, content: r.content }))
    );

    if (isErr(synthesisResult)) {
      await deps.researchRepo.update(researchId, {
        status: 'failed',
        synthesisError: synthesisResult.error.message,
        completedAt: new Date().toISOString(),
      });
    } else {
      await deps.researchRepo.update(researchId, {
        status: 'completed',
        synthesizedResult: synthesisResult.value,
        completedAt: new Date().toISOString(),
      });
    }
  } else {
    await deps.researchRepo.update(researchId, {
      status: 'failed',
      synthesisError: 'All LLM calls failed',
      completedAt: new Date().toISOString(),
    });
  }

  // Send notification (best effort)
  const updatedResearch = await deps.researchRepo.findById(researchId);
  if (!isErr(updatedResearch) && updatedResearch.value !== null) {
    await deps.notificationSender.sendResearchComplete(
      research.userId,
      researchId,
      updatedResearch.value.title
    );
  }
}

function getModelName(provider: LlmProvider): string {
  switch (provider) {
    case 'google':
      return 'Gemini';
    case 'openai':
      return 'GPT-4o';
    case 'anthropic':
      return 'Claude';
  }
}
```

### Step 4: Create usecases/getResearch.ts

```typescript
import type { Result } from '@intexuraos/common-core';
import type { Research } from '../models/index.js';
import type { ResearchRepository, RepositoryError } from '../ports/index.js';

export async function getResearch(
  id: string,
  deps: { researchRepo: ResearchRepository }
): Promise<Result<Research | null, RepositoryError>> {
  return await deps.researchRepo.findById(id);
}
```

### Step 5: Create usecases/listResearches.ts

```typescript
import type { Result } from '@intexuraos/common-core';
import type { Research } from '../models/index.js';
import type { ResearchRepository, RepositoryError } from '../ports/index.js';

export interface ListResearchesParams {
  userId: string;
  limit?: number;
  cursor?: string;
}

export interface ListResearchesResult {
  items: Research[];
  nextCursor?: string;
}

export async function listResearches(
  params: ListResearchesParams,
  deps: { researchRepo: ResearchRepository }
): Promise<Result<ListResearchesResult, RepositoryError>> {
  return await deps.researchRepo.findByUserId(params.userId, {
    limit: params.limit,
    cursor: params.cursor,
  });
}
```

### Step 6: Create usecases/deleteResearch.ts

```typescript
import type { Result } from '@intexuraos/common-core';
import type { ResearchRepository, RepositoryError } from '../ports/index.js';

export async function deleteResearch(
  id: string,
  deps: { researchRepo: ResearchRepository }
): Promise<Result<void, RepositoryError>> {
  return await deps.researchRepo.delete(id);
}
```

### Step 7: Create usecases/index.ts

```typescript
export {
  submitResearch,
  type SubmitResearchParams,
  type SubmitResearchDeps,
} from './submitResearch.js';
export { processResearch, type ProcessResearchDeps } from './processResearch.js';
export { getResearch } from './getResearch.js';
export {
  listResearches,
  type ListResearchesParams,
  type ListResearchesResult,
} from './listResearches.js';
export { deleteResearch } from './deleteResearch.js';
```

### Step 8: Update domain/research/index.ts

```typescript
export * from './models/index.js';
export * from './ports/index.js';
export * from './config/index.js';
export * from './usecases/index.js';
```

---

## Step Checklist

- [ ] Create usecases directory
- [ ] Implement `submitResearch`
- [ ] Implement `processResearch` with parallel LLM calls
- [ ] Implement `getResearch`
- [ ] Implement `listResearches`
- [ ] Implement `deleteResearch`
- [ ] Create `usecases/index.ts` with exports
- [ ] Update `domain/research/index.ts`
- [ ] Run verification commands

---

## Definition of Done

1. All 5 usecases implemented
2. `processResearch` runs LLM calls in parallel
3. Synthesis done after LLM results collected
4. Notification sent on completion
5. All exports available
6. `npm run typecheck` passes

---

## Verification Commands

```bash
npm run typecheck
npm run lint
```

---

## Rollback Plan

If verification fails:

1. Remove usecases directory
2. Revert changes to domain/research/index.ts
