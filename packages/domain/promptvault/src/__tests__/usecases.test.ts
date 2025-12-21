import { describe, it, expect, beforeEach } from 'vitest';
import { ok, err, type Result } from '@praxos/common';
import { createPrompt, listPrompts, getPrompt, updatePrompt } from '../usecases/index.js';
import type { PromptRepository, Prompt, PromptVaultError } from '../index.js';

/**
 * In-memory fake PromptRepository for testing use cases.
 */
function createFakePromptRepository(): PromptRepository {
  const prompts = new Map<string, Prompt>();
  let idCounter = 1;

  return {
    async createPrompt(userId, input): Promise<Result<Prompt, PromptVaultError>> {
      const id = `prompt-${String(idCounter++)}`;
      const now = new Date().toISOString();
      const prompt: Prompt = {
        id,
        title: input.title,
        content: input.content,
        createdAt: now,
        updatedAt: now,
      };
      prompts.set(`${userId}:${id}`, prompt);
      return await Promise.resolve(ok(prompt));
    },

    async listPrompts(userId): Promise<Result<Prompt[], PromptVaultError>> {
      const userPrompts: Prompt[] = [];
      for (const [key, prompt] of prompts) {
        if (key.startsWith(`${userId}:`)) {
          userPrompts.push(prompt);
        }
      }
      return await Promise.resolve(ok(userPrompts));
    },

    async getPrompt(userId, promptId): Promise<Result<Prompt, PromptVaultError>> {
      const key = `${userId}:${promptId}`;
      const prompt = prompts.get(key);
      if (prompt === undefined) {
        return await Promise.resolve(
          err({ code: 'NOT_FOUND', message: `Prompt ${promptId} not found` } as PromptVaultError)
        );
      }
      return await Promise.resolve(ok(prompt));
    },

    async updatePrompt(userId, promptId, input): Promise<Result<Prompt, PromptVaultError>> {
      const key = `${userId}:${promptId}`;
      const prompt = prompts.get(key);
      if (prompt === undefined) {
        return await Promise.resolve(
          err({ code: 'NOT_FOUND', message: `Prompt ${promptId} not found` } as PromptVaultError)
        );
      }
      const updated: Prompt = {
        ...prompt,
        title: input.title ?? prompt.title,
        content: input.content ?? prompt.content,
        updatedAt: new Date().toISOString(),
      };
      prompts.set(key, updated);
      return await Promise.resolve(ok(updated));
    },
  };
}

describe('PromptVault Use Cases', () => {
  let repository: PromptRepository;
  const userId = 'test-user-123';

  beforeEach(() => {
    repository = createFakePromptRepository();
  });

  describe('createPrompt', () => {
    it('creates a prompt with valid input', async () => {
      const result = await createPrompt(repository, {
        userId,
        title: 'Test Title',
        content: 'Test content',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Test Title');
        expect(result.value.content).toBe('Test content');
        expect(result.value.id).toBeDefined();
        expect(result.value.createdAt).toBeDefined();
      }
    });

    it('rejects empty title', async () => {
      const result = await createPrompt(repository, {
        userId,
        title: '',
        content: 'Test content',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toContain('title');
      }
    });

    it('rejects whitespace-only title', async () => {
      const result = await createPrompt(repository, {
        userId,
        title: '   ',
        content: 'Test content',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('rejects empty content', async () => {
      const result = await createPrompt(repository, {
        userId,
        title: 'Test Title',
        content: '',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toContain('content');
      }
    });

    it('rejects title exceeding max length', async () => {
      const result = await createPrompt(repository, {
        userId,
        title: 'x'.repeat(201),
        content: 'Test content',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toContain('200');
      }
    });

    it('accepts title at max length', async () => {
      const result = await createPrompt(repository, {
        userId,
        title: 'x'.repeat(200),
        content: 'Test content',
      });

      expect(result.ok).toBe(true);
    });

    it('rejects content exceeding max length', async () => {
      const result = await createPrompt(repository, {
        userId,
        title: 'Test Title',
        content: 'x'.repeat(100001),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toContain('100000');
      }
    });
  });

  describe('listPrompts', () => {
    it('returns empty list when no prompts exist', async () => {
      const result = await listPrompts(repository, { userId });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('returns all prompts for user', async () => {
      await createPrompt(repository, { userId, title: 'One', content: 'Content 1' });
      await createPrompt(repository, { userId, title: 'Two', content: 'Content 2' });

      const result = await listPrompts(repository, { userId });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
      }
    });

    it('does not return prompts from other users', async () => {
      await createPrompt(repository, { userId: 'other-user', title: 'Other', content: 'Content' });
      await createPrompt(repository, { userId, title: 'Mine', content: 'Content' });

      const result = await listPrompts(repository, { userId });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.title).toBe('Mine');
      }
    });
  });

  describe('getPrompt', () => {
    it('returns NOT_FOUND for non-existent prompt', async () => {
      const result = await getPrompt(repository, { userId, promptId: 'nonexistent' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('returns prompt when it exists', async () => {
      const createResult = await createPrompt(repository, {
        userId,
        title: 'Existing',
        content: 'Content',
      });
      if (!createResult.ok) throw new Error('Failed to create');

      const result = await getPrompt(repository, {
        userId,
        promptId: createResult.value.id,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Existing');
      }
    });

    it('rejects empty promptId', async () => {
      const result = await getPrompt(repository, { userId, promptId: '' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toContain('promptId');
      }
    });

    it('rejects whitespace-only promptId', async () => {
      const result = await getPrompt(repository, { userId, promptId: '   ' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });
  });

  describe('updatePrompt', () => {
    it('returns NOT_FOUND for non-existent prompt', async () => {
      const result = await updatePrompt(repository, {
        userId,
        promptId: 'nonexistent',
        title: 'New Title',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('updates title successfully', async () => {
      const createResult = await createPrompt(repository, {
        userId,
        title: 'Old Title',
        content: 'Content',
      });
      if (!createResult.ok) throw new Error('Failed to create');

      const result = await updatePrompt(repository, {
        userId,
        promptId: createResult.value.id,
        title: 'New Title',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('New Title');
        expect(result.value.content).toBe('Content');
      }
    });

    it('updates content successfully', async () => {
      const createResult = await createPrompt(repository, {
        userId,
        title: 'Title',
        content: 'Old Content',
      });
      if (!createResult.ok) throw new Error('Failed to create');

      const result = await updatePrompt(repository, {
        userId,
        promptId: createResult.value.id,
        content: 'New Content',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Title');
        expect(result.value.content).toBe('New Content');
      }
    });

    it('updates both title and content', async () => {
      const createResult = await createPrompt(repository, {
        userId,
        title: 'Old Title',
        content: 'Old Content',
      });
      if (!createResult.ok) throw new Error('Failed to create');

      const result = await updatePrompt(repository, {
        userId,
        promptId: createResult.value.id,
        title: 'New Title',
        content: 'New Content',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('New Title');
        expect(result.value.content).toBe('New Content');
      }
    });

    it('rejects empty update (no title or content)', async () => {
      const createResult = await createPrompt(repository, {
        userId,
        title: 'Title',
        content: 'Content',
      });
      if (!createResult.ok) throw new Error('Failed to create');

      const result = await updatePrompt(repository, {
        userId,
        promptId: createResult.value.id,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('rejects title exceeding max length', async () => {
      const createResult = await createPrompt(repository, {
        userId,
        title: 'Title',
        content: 'Content',
      });
      if (!createResult.ok) throw new Error('Failed to create');

      const result = await updatePrompt(repository, {
        userId,
        promptId: createResult.value.id,
        title: 'x'.repeat(201),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('rejects empty promptId', async () => {
      const result = await updatePrompt(repository, {
        userId,
        promptId: '',
        title: 'New Title',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toContain('promptId');
      }
    });

    it('rejects whitespace-only promptId', async () => {
      const result = await updatePrompt(repository, {
        userId,
        promptId: '   ',
        title: 'New Title',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('rejects empty title string', async () => {
      const createResult = await createPrompt(repository, {
        userId,
        title: 'Title',
        content: 'Content',
      });
      if (!createResult.ok) throw new Error('Failed to create');

      const result = await updatePrompt(repository, {
        userId,
        promptId: createResult.value.id,
        title: '',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toContain('title');
      }
    });

    it('rejects whitespace-only title', async () => {
      const createResult = await createPrompt(repository, {
        userId,
        title: 'Title',
        content: 'Content',
      });
      if (!createResult.ok) throw new Error('Failed to create');

      const result = await updatePrompt(repository, {
        userId,
        promptId: createResult.value.id,
        title: '   ',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('rejects empty content string', async () => {
      const createResult = await createPrompt(repository, {
        userId,
        title: 'Title',
        content: 'Content',
      });
      if (!createResult.ok) throw new Error('Failed to create');

      const result = await updatePrompt(repository, {
        userId,
        promptId: createResult.value.id,
        content: '',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toContain('content');
      }
    });

    it('rejects content exceeding max length', async () => {
      const createResult = await createPrompt(repository, {
        userId,
        title: 'Title',
        content: 'Content',
      });
      if (!createResult.ok) throw new Error('Failed to create');

      const result = await updatePrompt(repository, {
        userId,
        promptId: createResult.value.id,
        content: 'x'.repeat(100001),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });
  });

  describe('factory functions', () => {
    it('createCreatePromptUseCase returns a working function', async () => {
      const { createCreatePromptUseCase } = await import('../usecases/index.js');
      const boundCreate = createCreatePromptUseCase(repository);

      const result = await boundCreate({
        userId,
        title: 'Factory Test',
        content: 'Content',
      });

      expect(result.ok).toBe(true);
    });

    it('createListPromptsUseCase returns a working function', async () => {
      const { createListPromptsUseCase } = await import('../usecases/index.js');
      const boundList = createListPromptsUseCase(repository);

      const result = await boundList({ userId });

      expect(result.ok).toBe(true);
    });

    it('createGetPromptUseCase returns a working function', async () => {
      const { createGetPromptUseCase } = await import('../usecases/index.js');
      const boundGet = createGetPromptUseCase(repository);

      const result = await boundGet({ userId, promptId: 'test-id' });

      // Will be NOT_FOUND since we didn't create the prompt, but that's fine
      expect(result.ok).toBe(false);
    });

    it('createUpdatePromptUseCase returns a working function', async () => {
      const { createUpdatePromptUseCase } = await import('../usecases/index.js');
      const boundUpdate = createUpdatePromptUseCase(repository);

      const result = await boundUpdate({
        userId,
        promptId: 'test-id',
        title: 'Updated',
      });

      // Will be NOT_FOUND since we didn't create the prompt, but that's fine
      expect(result.ok).toBe(false);
    });
  });
});
