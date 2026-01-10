# Task 8-0: Create Route Tests

**Tier:** 8 (Testing & Verification)

---

## Context Snapshot

- All routes implemented (Tier 5)
- Need integration tests using fake repositories
- Following patterns from existing services

**Working according to:** `.github/prompts/continuity.prompt.md`

---

## Problem Statement

Create integration tests for research routes:

1. POST /research
2. GET /research
3. GET /research/:id
4. DELETE /research/:id

---

## Scope

**In scope:**

- Create fake ResearchRepository
- Create route integration tests
- Test authentication
- Test error cases

**Non-scope:**

- Unit tests for usecases (task 8-1)
- Coverage verification (task 8-2)

---

## Required Approach

### Step 1: Create fakes directory

```bash
mkdir -p apps/research-agent-service/src/__tests__/fakes
```

### Step 2: Create FakeResearchRepository

`apps/research-agent-service/src/__tests__/fakes/FakeResearchRepository.ts`:

```typescript
import { ok, err, type Result } from '@intexuraos/common-core';
import type {
  Research,
  LlmResult,
  LlmProvider,
  ResearchRepository,
  RepositoryError,
} from '../../domain/research/index.js';

export class FakeResearchRepository implements ResearchRepository {
  private researches: Map<string, Research> = new Map();

  async save(research: Research): Promise<Result<Research, RepositoryError>> {
    this.researches.set(research.id, research);
    return ok(research);
  }

  async findById(id: string): Promise<Result<Research | null, RepositoryError>> {
    const research = this.researches.get(id);
    return ok(research ?? null);
  }

  async findByUserId(
    userId: string,
    options?: { limit?: number; cursor?: string }
  ): Promise<Result<{ items: Research[]; nextCursor?: string }, RepositoryError>> {
    const items = Array.from(this.researches.values())
      .filter((r) => r.userId === userId)
      .slice(0, options?.limit ?? 50);
    return ok({ items });
  }

  async update(id: string, updates: Partial<Research>): Promise<Result<Research, RepositoryError>> {
    const existing = this.researches.get(id);
    if (!existing) {
      return err({ code: 'NOT_FOUND', message: 'Not found' });
    }
    const updated = { ...existing, ...updates };
    this.researches.set(id, updated);
    return ok(updated);
  }

  async updateLlmResult(
    researchId: string,
    provider: LlmProvider,
    result: Partial<LlmResult>
  ): Promise<Result<void, RepositoryError>> {
    const existing = this.researches.get(researchId);
    if (!existing) {
      return err({ code: 'NOT_FOUND', message: 'Not found' });
    }
    const llmResults = existing.llmResults.map((r) =>
      r.provider === provider ? { ...r, ...result } : r
    );
    this.researches.set(researchId, { ...existing, llmResults });
    return ok(undefined);
  }

  async delete(id: string): Promise<Result<void, RepositoryError>> {
    this.researches.delete(id);
    return ok(undefined);
  }

  // Test helpers
  clear(): void {
    this.researches.clear();
  }

  seed(research: Research): void {
    this.researches.set(research.id, research);
  }
}
```

### Step 3: Create route tests

`apps/research-agent-service/src/__tests__/researchRoutes.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildServer } from '../server.js';
import { setServices, resetServices } from '../services.js';
import { FakeResearchRepository } from './fakes/FakeResearchRepository.js';
import type { Research } from '../domain/research/index.js';

describe('Research Routes', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let fakeRepo: FakeResearchRepository;

  const testUserId = 'user-123';
  const testToken = Buffer.from(JSON.stringify({ sub: testUserId })).toString('base64');
  const authHeader = `Bearer header.${testToken}.signature`;

  beforeEach(async () => {
    fakeRepo = new FakeResearchRepository();
    setServices({
      researchRepo: fakeRepo,
      generateId: () => 'test-id-123',
      processResearchAsync: async () => {},
      encryptor: {
        encrypt: () => ({ ok: true, value: { ciphertext: '', iv: '', tag: '' } }),
        decrypt: () => ({ ok: true, value: '' }),
      },
    });
    app = await buildServer();
  });

  afterEach(() => {
    resetServices();
  });

  describe('POST /research', () => {
    it('creates research successfully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/research',
        headers: { authorization: authHeader },
        payload: {
          prompt: 'Research about AI safety',
          selectedLlms: ['google'],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('test-id-123');
      expect(body.data.prompt).toBe('Research about AI safety');
    });

    it('returns 401 without auth', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/research',
        payload: {
          prompt: 'Research about AI safety',
          selectedLlms: ['google'],
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 400 for invalid body', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/research',
        headers: { authorization: authHeader },
        payload: {
          prompt: 'short',
          selectedLlms: [],
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /research', () => {
    it('lists user researches', async () => {
      fakeRepo.seed({
        id: 'research-1',
        userId: testUserId,
        title: 'Test',
        prompt: 'Test prompt',
        selectedLlms: ['google'],
        status: 'completed',
        llmResults: [],
        startedAt: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'GET',
        url: '/research',
        headers: { authorization: authHeader },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.items).toHaveLength(1);
    });
  });

  describe('GET /research/:id', () => {
    it('returns research by id', async () => {
      const research: Research = {
        id: 'research-1',
        userId: testUserId,
        title: 'Test',
        prompt: 'Test prompt',
        selectedLlms: ['google'],
        status: 'completed',
        llmResults: [],
        startedAt: new Date().toISOString(),
      };
      fakeRepo.seed(research);

      const response = await app.inject({
        method: 'GET',
        url: '/research/research-1',
        headers: { authorization: authHeader },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.id).toBe('research-1');
    });

    it('returns 404 for non-existent research', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/research/non-existent',
        headers: { authorization: authHeader },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 403 for other users research', async () => {
      fakeRepo.seed({
        id: 'research-1',
        userId: 'other-user',
        title: 'Test',
        prompt: 'Test prompt',
        selectedLlms: ['google'],
        status: 'completed',
        llmResults: [],
        startedAt: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'GET',
        url: '/research/research-1',
        headers: { authorization: authHeader },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('DELETE /research/:id', () => {
    it('deletes research successfully', async () => {
      fakeRepo.seed({
        id: 'research-1',
        userId: testUserId,
        title: 'Test',
        prompt: 'Test prompt',
        selectedLlms: ['google'],
        status: 'completed',
        llmResults: [],
        startedAt: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'DELETE',
        url: '/research/research-1',
        headers: { authorization: authHeader },
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
```

---

## Step Checklist

- [ ] Create fakes directory
- [ ] Create FakeResearchRepository
- [ ] Create route tests
- [ ] Test all endpoints
- [ ] Test auth and ownership
- [ ] Run tests

---

## Definition of Done

1. Fake repository implemented
2. All routes tested
3. Auth tested
4. Error cases tested
5. Tests pass

---

## Verification Commands

```bash
npm run test -- apps/research-agent-service
```

---

## Rollback Plan

If verification fails:

1. Remove test files

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
