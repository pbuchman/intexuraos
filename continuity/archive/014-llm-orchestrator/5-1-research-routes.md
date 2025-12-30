# Task 5-1: Implement Research Routes

**Tier:** 5 (Depends on 5-0 schemas and Tier 3-4)

---

## Context Snapshot

- JSON schemas defined (5-0)
- Domain usecases available (Tier 3)
- Infrastructure adapters available (Tier 4)
- Need HTTP endpoints for research CRUD

**Working according to:** `.github/prompts/continuity.prompt.md`

---

## Problem Statement

Implement REST endpoints:

- `POST /research` — create new research
- `GET /research` — list user's researches
- `GET /research/:id` — get single research
- `DELETE /research/:id` — delete research

---

## Scope

**In scope:**

- Route handlers for all endpoints
- Authentication middleware integration
- Error response formatting
- Trigger async processing on create

**Non-scope:**

- Server setup (task 5-2)
- DI container (task 5-3)

---

## Required Approach

### Step 1: Create routes directory

```bash
mkdir -p apps/llm-orchestrator-service/src/routes
```

### Step 2: Create routes/researchRoutes.ts

```typescript
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { isErr } from '@intexuraos/common-core';
import {
  submitResearch,
  getResearch,
  listResearches,
  deleteResearch,
  processResearch,
  type LlmProvider,
} from '../domain/research/index.js';
import { getServices } from '../services.js';
import {
  createResearchBodySchema,
  createResearchResponseSchema,
  listResearchesQuerySchema,
  listResearchesResponseSchema,
  getResearchResponseSchema,
  deleteResearchResponseSchema,
  researchIdParamsSchema,
} from './schemas/index.js';

interface CreateResearchBody {
  prompt: string;
  selectedLlms: LlmProvider[];
}

interface ListResearchesQuery {
  limit?: number;
  cursor?: string;
}

interface ResearchIdParams {
  id: string;
}

export async function researchRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /research
  fastify.post<{
    Body: CreateResearchBody;
  }>(
    '/research',
    {
      schema: {
        body: createResearchBodySchema,
        response: { 201: createResearchResponseSchema },
      },
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      const userId = request.user.sub;
      const { prompt, selectedLlms } = request.body;
      const { researchRepo, generateId, processResearchAsync } = getServices();

      const result = await submitResearch(
        { userId, prompt, selectedLlms },
        { researchRepo, generateId }
      );

      if (isErr(result)) {
        return reply.code(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: result.error.message },
        });
      }

      // Trigger async processing (fire and forget)
      void processResearchAsync(result.value.id);

      return reply.code(201).send({
        success: true,
        data: result.value,
      });
    }
  );

  // GET /research
  fastify.get<{
    Querystring: ListResearchesQuery;
  }>(
    '/research',
    {
      schema: {
        querystring: listResearchesQuerySchema,
        response: { 200: listResearchesResponseSchema },
      },
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      const userId = request.user.sub;
      const { limit, cursor } = request.query;
      const { researchRepo } = getServices();

      const result = await listResearches({ userId, limit, cursor }, { researchRepo });

      if (isErr(result)) {
        return reply.code(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: result.error.message },
        });
      }

      return reply.send({
        success: true,
        data: result.value,
      });
    }
  );

  // GET /research/:id
  fastify.get<{
    Params: ResearchIdParams;
  }>(
    '/research/:id',
    {
      schema: {
        params: researchIdParamsSchema,
        response: { 200: getResearchResponseSchema },
      },
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      const { id } = request.params;
      const userId = request.user.sub;
      const { researchRepo } = getServices();

      const result = await getResearch(id, { researchRepo });

      if (isErr(result)) {
        return reply.code(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: result.error.message },
        });
      }

      if (result.value === null) {
        return reply.code(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Research not found' },
        });
      }

      // Check ownership
      if (result.value.userId !== userId) {
        return reply.code(403).send({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Access denied' },
        });
      }

      return reply.send({
        success: true,
        data: result.value,
      });
    }
  );

  // DELETE /research/:id
  fastify.delete<{
    Params: ResearchIdParams;
  }>(
    '/research/:id',
    {
      schema: {
        params: researchIdParamsSchema,
        response: { 200: deleteResearchResponseSchema },
      },
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      const { id } = request.params;
      const userId = request.user.sub;
      const { researchRepo } = getServices();

      // Check ownership first
      const existing = await getResearch(id, { researchRepo });
      if (isErr(existing) || existing.value === null) {
        return reply.code(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Research not found' },
        });
      }

      if (existing.value.userId !== userId) {
        return reply.code(403).send({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Access denied' },
        });
      }

      const result = await deleteResearch(id, { researchRepo });

      if (isErr(result)) {
        return reply.code(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: result.error.message },
        });
      }

      return reply.send({ success: true });
    }
  );
}
```

### Step 3: Create routes/index.ts

```typescript
export { researchRoutes } from './researchRoutes.js';
```

---

## Step Checklist

- [ ] Create routes directory
- [ ] Implement `POST /research` with async processing trigger
- [ ] Implement `GET /research` with pagination
- [ ] Implement `GET /research/:id` with ownership check
- [ ] Implement `DELETE /research/:id` with ownership check
- [ ] Create index file
- [ ] Run verification commands

---

## Definition of Done

1. All 4 endpoints implemented
2. Authentication integrated
3. Ownership checks for single-resource endpoints
4. Async processing triggered on create
5. Error responses formatted correctly
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

1. Remove routes directory (except schemas)
