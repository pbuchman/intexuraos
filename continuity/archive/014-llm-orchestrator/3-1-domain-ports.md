# Task 3-1: Define Domain Ports

**Tier:** 3 (Depends on 3-0 models)

---

## Context Snapshot

- Research and LlmResult models defined (task 3-0)
- Hexagonal architecture: ports define interfaces for adapters
- Ports are implemented by infrastructure layer (Firestore, LLM clients)

**Working according to:** `.github/prompts/continuity.prompt.md`

---

## Problem Statement

Define port interfaces that the domain layer uses to interact with:

1. Research persistence (Firestore)
2. LLM research providers (Gemini, Claude, GPT)
3. Notification sender (WhatsApp)

---

## Scope

**In scope:**

- `ResearchRepository` port for persistence
- `LlmResearchProvider` port for LLM calls
- `NotificationSender` port for notifications
- Error types for each port

**Non-scope:**

- Actual implementations (done in Tier 4)
- HTTP transport layer

---

## Required Approach

### Step 1: Create ports directory

```bash
mkdir -p apps/research-agent-service/src/domain/research/ports
```

### Step 2: Create ports/repository.ts

```typescript
import type { Result } from '@intexuraos/common-core';
import type { Research, LlmResult, LlmProvider } from '../models/index.js';

export interface RepositoryError {
  code: 'NOT_FOUND' | 'FIRESTORE_ERROR' | 'CONFLICT';
  message: string;
}

export interface ResearchRepository {
  save(research: Research): Promise<Result<Research, RepositoryError>>;

  findById(id: string): Promise<Result<Research | null, RepositoryError>>;

  findByUserId(
    userId: string,
    options?: { limit?: number; cursor?: string }
  ): Promise<Result<{ items: Research[]; nextCursor?: string }, RepositoryError>>;

  update(id: string, updates: Partial<Research>): Promise<Result<Research, RepositoryError>>;

  updateLlmResult(
    researchId: string,
    provider: LlmProvider,
    result: Partial<LlmResult>
  ): Promise<Result<void, RepositoryError>>;

  delete(id: string): Promise<Result<void, RepositoryError>>;
}
```

### Step 3: Create ports/llmProvider.ts

```typescript
import type { Result } from '@intexuraos/common-core';

export interface LlmError {
  code: 'API_ERROR' | 'TIMEOUT' | 'INVALID_KEY' | 'RATE_LIMITED';
  message: string;
}

export interface LlmResearchResult {
  content: string;
  sources?: string[];
}

export interface LlmResearchProvider {
  research(prompt: string): Promise<Result<LlmResearchResult, LlmError>>;
}

export interface LlmSynthesisProvider {
  synthesize(
    originalPrompt: string,
    reports: Array<{ model: string; content: string }>
  ): Promise<Result<string, LlmError>>;

  generateTitle(prompt: string): Promise<Result<string, LlmError>>;
}
```

### Step 4: Create ports/notification.ts

```typescript
import type { Result } from '@intexuraos/common-core';

export interface NotificationError {
  code: 'SEND_FAILED' | 'USER_NOT_CONNECTED';
  message: string;
}

export interface NotificationSender {
  sendResearchComplete(
    userId: string,
    researchId: string,
    title: string
  ): Promise<Result<void, NotificationError>>;
}
```

### Step 5: Create ports/index.ts

```typescript
export type { RepositoryError, ResearchRepository } from './repository.js';

export type {
  LlmError,
  LlmResearchResult,
  LlmResearchProvider,
  LlmSynthesisProvider,
} from './llmProvider.js';

export type { NotificationError, NotificationSender } from './notification.js';
```

### Step 6: Update domain/research/index.ts

```typescript
export * from './models/index.js';
export * from './ports/index.js';
```

---

## Step Checklist

- [ ] Create ports directory
- [ ] Create `repository.ts` with ResearchRepository interface
- [ ] Create `llmProvider.ts` with LLM interfaces
- [ ] Create `notification.ts` with NotificationSender interface
- [ ] Create `ports/index.ts` with exports
- [ ] Update `domain/research/index.ts`
- [ ] Run verification commands

---

## Definition of Done

1. `ResearchRepository` interface defined with CRUD operations
2. `LlmResearchProvider` and `LlmSynthesisProvider` interfaces defined
3. `NotificationSender` interface defined
4. All ports exported from domain/research
5. `npm run typecheck` passes

---

## Verification Commands

```bash
npm run typecheck
npm run lint
```

---

## Rollback Plan

If verification fails:

1. Remove ports directory
2. Revert changes to domain/research/index.ts
