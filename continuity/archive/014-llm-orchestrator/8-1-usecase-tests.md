# Task 8-1: Create Usecase Tests

**Tier:** 8 (Depends on 8-0)

---

## Context Snapshot

- Fake repositories available (8-0)
- Need unit tests for domain usecases
- Focus on business logic testing

**Working according to:** `.github/prompts/continuity.prompt.md`

---

## Problem Statement

Create unit tests for:

1. submitResearch
2. processResearch
3. getResearch
4. listResearches
5. deleteResearch

---

## Scope

**In scope:**

- Unit tests for each usecase
- Fake LLM providers
- Fake notification sender
- Edge case testing

**Non-scope:**

- Route tests (task 8-0)
- Coverage verification (task 8-2)

---

## Required Approach

### Step 1: Create fake LLM providers

`apps/llm-orchestrator-service/src/__tests__/fakes/FakeLlmProviders.ts`:

```typescript
import { ok, err, type Result } from '@intexuraos/common-core';
import type {
  LlmResearchProvider,
  LlmSynthesisProvider,
  LlmResearchResult,
  LlmError,
} from '../../domain/research/index.js';

export class FakeLlmProvider implements LlmResearchProvider {
  private response: LlmResearchResult = { content: 'Fake response' };
  private shouldFail = false;

  setResponse(response: LlmResearchResult): void {
    this.response = response;
  }

  setFail(fail: boolean): void {
    this.shouldFail = fail;
  }

  async research(_prompt: string): Promise<Result<LlmResearchResult, LlmError>> {
    if (this.shouldFail) {
      return err({ code: 'API_ERROR', message: 'Fake error' });
    }
    return ok(this.response);
  }
}

export class FakeSynthesizer implements LlmSynthesisProvider {
  private synthesisResult = 'Synthesized result';
  private titleResult = 'Generated Title';

  setSynthesisResult(result: string): void {
    this.synthesisResult = result;
  }

  setTitleResult(title: string): void {
    this.titleResult = title;
  }

  async synthesize(
    _originalPrompt: string,
    _reports: Array<{ model: string; content: string }>
  ): Promise<Result<string, LlmError>> {
    return ok(this.synthesisResult);
  }

  async generateTitle(_prompt: string): Promise<Result<string, LlmError>> {
    return ok(this.titleResult);
  }
}
```

### Step 2: Create fake notification sender

`apps/llm-orchestrator-service/src/__tests__/fakes/FakeNotificationSender.ts`:

```typescript
import { ok, type Result } from '@intexuraos/common-core';
import type { NotificationSender, NotificationError } from '../../domain/research/index.js';

export class FakeNotificationSender implements NotificationSender {
  public sentNotifications: Array<{ userId: string; researchId: string; title: string }> = [];

  async sendResearchComplete(
    userId: string,
    researchId: string,
    title: string
  ): Promise<Result<void, NotificationError>> {
    this.sentNotifications.push({ userId, researchId, title });
    return ok(undefined);
  }

  clear(): void {
    this.sentNotifications = [];
  }
}
```

### Step 3: Create usecase tests

`apps/llm-orchestrator-service/src/__tests__/usecases.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import {
  submitResearch,
  processResearch,
  getResearch,
  listResearches,
  deleteResearch,
} from '../domain/research/index.js';
import { FakeResearchRepository } from './fakes/FakeResearchRepository.js';
import { FakeLlmProvider, FakeSynthesizer } from './fakes/FakeLlmProviders.js';
import { FakeNotificationSender } from './fakes/FakeNotificationSender.js';

describe('Research Usecases', () => {
  let researchRepo: FakeResearchRepository;
  let googleProvider: FakeLlmProvider;
  let synthesizer: FakeSynthesizer;
  let notificationSender: FakeNotificationSender;

  beforeEach(() => {
    researchRepo = new FakeResearchRepository();
    googleProvider = new FakeLlmProvider();
    synthesizer = new FakeSynthesizer();
    notificationSender = new FakeNotificationSender();
  });

  describe('submitResearch', () => {
    it('creates research with pending status', async () => {
      const result = await submitResearch(
        {
          userId: 'user-1',
          prompt: 'Test prompt',
          selectedLlms: ['google'],
        },
        {
          researchRepo,
          generateId: () => 'test-id',
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('test-id');
        expect(result.value.status).toBe('pending');
        expect(result.value.llmResults).toHaveLength(1);
      }
    });
  });

  describe('processResearch', () => {
    it('processes research and synthesizes results', async () => {
      // Setup
      await submitResearch(
        {
          userId: 'user-1',
          prompt: 'Test prompt',
          selectedLlms: ['google'],
        },
        {
          researchRepo,
          generateId: () => 'test-id',
        }
      );

      googleProvider.setResponse({ content: 'Google result' });
      synthesizer.setSynthesisResult('Final synthesis');
      synthesizer.setTitleResult('Test Title');

      // Process
      await processResearch('test-id', {
        researchRepo,
        llmProviders: { google: googleProvider, openai: googleProvider, anthropic: googleProvider },
        synthesizer,
        notificationSender,
      });

      // Verify
      const result = await researchRepo.findById('test-id');
      expect(result.ok).toBe(true);
      if (result.ok && result.value) {
        expect(result.value.status).toBe('completed');
        expect(result.value.title).toBe('Test Title');
        expect(result.value.synthesizedResult).toBe('Final synthesis');
      }
    });

    it('sends notification on completion', async () => {
      await submitResearch(
        { userId: 'user-1', prompt: 'Test', selectedLlms: ['google'] },
        { researchRepo, generateId: () => 'test-id' }
      );

      await processResearch('test-id', {
        researchRepo,
        llmProviders: { google: googleProvider, openai: googleProvider, anthropic: googleProvider },
        synthesizer,
        notificationSender,
      });

      expect(notificationSender.sentNotifications).toHaveLength(1);
    });
  });

  describe('getResearch', () => {
    it('returns research by id', async () => {
      await submitResearch(
        { userId: 'user-1', prompt: 'Test', selectedLlms: ['google'] },
        { researchRepo, generateId: () => 'test-id' }
      );

      const result = await getResearch('test-id', { researchRepo });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value?.id).toBe('test-id');
      }
    });

    it('returns null for non-existent id', async () => {
      const result = await getResearch('non-existent', { researchRepo });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });
  });

  describe('listResearches', () => {
    it('returns researches for user', async () => {
      await submitResearch(
        { userId: 'user-1', prompt: 'Test 1', selectedLlms: ['google'] },
        { researchRepo, generateId: () => 'id-1' }
      );
      await submitResearch(
        { userId: 'user-1', prompt: 'Test 2', selectedLlms: ['google'] },
        { researchRepo, generateId: () => 'id-2' }
      );

      const result = await listResearches({ userId: 'user-1' }, { researchRepo });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.items).toHaveLength(2);
      }
    });
  });

  describe('deleteResearch', () => {
    it('deletes research', async () => {
      await submitResearch(
        { userId: 'user-1', prompt: 'Test', selectedLlms: ['google'] },
        { researchRepo, generateId: () => 'test-id' }
      );

      const deleteResult = await deleteResearch('test-id', { researchRepo });
      expect(deleteResult.ok).toBe(true);

      const getResult = await getResearch('test-id', { researchRepo });
      if (getResult.ok) {
        expect(getResult.value).toBeNull();
      }
    });
  });
});
```

---

## Step Checklist

- [ ] Create FakeLlmProvider
- [ ] Create FakeSynthesizer
- [ ] Create FakeNotificationSender
- [ ] Create usecase tests
- [ ] Test all usecases
- [ ] Test edge cases
- [ ] Run tests

---

## Definition of Done

1. All fake adapters implemented
2. All usecases tested
3. Edge cases covered
4. Tests pass

---

## Verification Commands

```bash
npm run test -- apps/llm-orchestrator-service
```

---

## Rollback Plan

If verification fails:

1. Remove test files

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
