# Task 5-0: Create JSON Schemas for Routes

**Tier:** 5 (Routes layer — depends on Tier 3-4)

---

## Context Snapshot

- Domain models defined (Tier 3)
- Need Fastify JSON schemas for request/response validation
- Following patterns from existing services

**Working according to:** `.github/prompts/continuity.prompt.md`

---

## Problem Statement

Create JSON schemas for:

1. Create research request/response
2. List researches request/response
3. Get research response
4. Delete research response

---

## Scope

**In scope:**

- JSON schemas for all research endpoints
- OpenAPI schema generation support
- Common schema components (Research, LlmResult)

**Non-scope:**

- Route implementations (task 5-1)
- Server setup (task 5-2)

---

## Required Approach

### Step 1: Create schemas directory

```bash
mkdir -p apps/llm-orchestrator-service/src/routes/schemas
```

### Step 2: Create schemas/common.ts

```typescript
export const llmProviderSchema = {
  type: 'string',
  enum: ['google', 'openai', 'anthropic'],
} as const;

export const researchStatusSchema = {
  type: 'string',
  enum: ['pending', 'processing', 'completed', 'failed'],
} as const;

export const llmResultSchema = {
  type: 'object',
  properties: {
    provider: llmProviderSchema,
    model: { type: 'string' },
    status: { type: 'string', enum: ['pending', 'processing', 'completed', 'failed'] },
    result: { type: 'string', nullable: true },
    error: { type: 'string', nullable: true },
    sources: { type: 'array', items: { type: 'string' }, nullable: true },
    startedAt: { type: 'string', nullable: true },
    completedAt: { type: 'string', nullable: true },
    durationMs: { type: 'number', nullable: true },
  },
  required: ['provider', 'model', 'status'],
} as const;

export const researchSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    title: { type: 'string' },
    prompt: { type: 'string' },
    selectedLlms: {
      type: 'array',
      items: llmProviderSchema,
    },
    status: researchStatusSchema,
    llmResults: {
      type: 'array',
      items: llmResultSchema,
    },
    synthesizedResult: { type: 'string', nullable: true },
    synthesisError: { type: 'string', nullable: true },
    startedAt: { type: 'string' },
    completedAt: { type: 'string', nullable: true },
    totalDurationMs: { type: 'number', nullable: true },
  },
  required: [
    'id',
    'userId',
    'title',
    'prompt',
    'selectedLlms',
    'status',
    'llmResults',
    'startedAt',
  ],
} as const;
```

### Step 3: Create schemas/researchSchemas.ts

```typescript
import { researchSchema, llmProviderSchema } from './common.js';

export const createResearchBodySchema = {
  type: 'object',
  required: ['prompt', 'selectedLlms'],
  properties: {
    prompt: {
      type: 'string',
      minLength: 10,
      maxLength: 10000,
    },
    selectedLlms: {
      type: 'array',
      items: llmProviderSchema,
      minItems: 1,
      maxItems: 3,
    },
  },
} as const;

export const createResearchResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    data: researchSchema,
    diagnostics: {
      type: 'object',
      properties: {
        requestId: { type: 'string' },
        durationMs: { type: 'number' },
      },
    },
  },
} as const;

export const listResearchesQuerySchema = {
  type: 'object',
  properties: {
    limit: { type: 'number', minimum: 1, maximum: 100, default: 50 },
    cursor: { type: 'string' },
  },
} as const;

export const listResearchesResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    data: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: researchSchema,
        },
        nextCursor: { type: 'string', nullable: true },
      },
    },
    diagnostics: {
      type: 'object',
      properties: {
        requestId: { type: 'string' },
        durationMs: { type: 'number' },
      },
    },
  },
} as const;

export const getResearchResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    data: researchSchema,
    diagnostics: {
      type: 'object',
      properties: {
        requestId: { type: 'string' },
        durationMs: { type: 'number' },
      },
    },
  },
} as const;

export const deleteResearchResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    diagnostics: {
      type: 'object',
      properties: {
        requestId: { type: 'string' },
        durationMs: { type: 'number' },
      },
    },
  },
} as const;

export const researchIdParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string' },
  },
} as const;
```

### Step 4: Create schemas/index.ts

```typescript
export * from './common.js';
export * from './researchSchemas.js';
```

---

## Step Checklist

- [ ] Create schemas directory
- [ ] Create `common.ts` with reusable schemas
- [ ] Create `researchSchemas.ts` with endpoint schemas
- [ ] Create `index.ts` with exports
- [ ] Run verification commands

---

## Definition of Done

1. All JSON schemas defined
2. Request body schemas with validation rules
3. Response schemas match domain models
4. Schemas follow Fastify format
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

1. Remove schemas directory
