# Task 3-0: Define Research Domain Models

**Tier:** 3 (LLM Orchestrator domain — depends on Tier 1-2)

---

## Context Snapshot

- llm-orchestrator-service scaffold exists (Tier 0)
- Infra packages ready (Tier 1)
- Following hexagonal architecture: domain has no external dependencies
- Models define the core Research entity and LlmResult value objects

**Working according to:** `.github/prompts/continuity.prompt.md`

---

## Problem Statement

Define the core domain models for the research feature:

- `Research` — aggregate root representing a research job
- `LlmResult` — value object for individual LLM response
- Factory function for creating new research instances

---

## Scope

**In scope:**

- Create `Research` interface with all fields
- Create `LlmResult` interface
- Create `LlmProvider` and status types
- Create `createResearch()` factory function
- Export from domain/research/models/index.ts

**Non-scope:**

- Persistence logic (Firestore repository)
- HTTP request/response types (routes)
- Validation logic

---

## Required Approach

### Step 1: Create directory structure

```bash
mkdir -p apps/llm-orchestrator-service/src/domain/research/models
```

### Step 2: Create models/Research.ts

```typescript
export type LlmProvider = 'google' | 'openai' | 'anthropic';

export type ResearchStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type LlmResultStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface LlmResult {
  provider: LlmProvider;
  model: string;
  status: LlmResultStatus;
  result?: string;
  error?: string;
  sources?: string[];
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
}

export interface Research {
  id: string;
  userId: string;
  title: string;
  prompt: string;
  selectedLlms: LlmProvider[];
  status: ResearchStatus;
  llmResults: LlmResult[];
  synthesizedResult?: string;
  synthesisError?: string;
  startedAt: string;
  completedAt?: string;
  totalDurationMs?: number;
}

export function createResearch(params: {
  id: string;
  userId: string;
  prompt: string;
  selectedLlms: LlmProvider[];
}): Research {
  return {
    id: params.id,
    userId: params.userId,
    title: '', // Generated later via Gemini
    prompt: params.prompt,
    selectedLlms: params.selectedLlms,
    status: 'pending',
    llmResults: params.selectedLlms.map((provider) => ({
      provider,
      model: getDefaultModel(provider),
      status: 'pending',
    })),
    startedAt: new Date().toISOString(),
  };
}

function getDefaultModel(provider: LlmProvider): string {
  switch (provider) {
    case 'google':
      return 'gemini-2.0-flash-exp';
    case 'openai':
      return 'gpt-4o';
    case 'anthropic':
      return 'claude-sonnet-4-20250514';
  }
}
```

### Step 3: Create models/index.ts

```typescript
export {
  type LlmProvider,
  type ResearchStatus,
  type LlmResultStatus,
  type LlmResult,
  type Research,
  createResearch,
} from './Research.js';
```

### Step 4: Create domain/research/index.ts

```typescript
export * from './models/index.js';
```

---

## Step Checklist

- [ ] Create directory structure
- [ ] Create `Research.ts` with types and interfaces
- [ ] Create `createResearch()` factory function
- [ ] Create `models/index.ts` with exports
- [ ] Create `domain/research/index.ts`
- [ ] Run verification commands

---

## Definition of Done

1. `Research` interface defined with all fields
2. `LlmResult` interface defined
3. Status types defined
4. Factory function `createResearch()` implemented
5. All types exported
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

1. Remove `apps/llm-orchestrator-service/src/domain/research/` directory
