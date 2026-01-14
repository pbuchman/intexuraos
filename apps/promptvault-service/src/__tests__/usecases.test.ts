/**
 * Unit tests for promptvault use cases.
 */
import { describe, expect, it } from 'vitest';
import { err, isErr, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import {
  createCreatePromptUseCase,
  createPrompt,
} from '../domain/promptvault/usecases/CreatePromptUseCase.js';
import {
  createGetPromptUseCase,
  getPrompt,
} from '../domain/promptvault/usecases/GetPromptUseCase.js';
import {
  createListPromptsUseCase,
  listPrompts,
} from '../domain/promptvault/usecases/ListPromptsUseCase.js';
import {
  createUpdatePromptUseCase,
  updatePrompt,
} from '../domain/promptvault/usecases/UpdatePromptUseCase.js';
import type { PromptRepository } from '../domain/promptvault/ports/index.js';
import type { Prompt, PromptVaultError } from '../domain/promptvault/models/index.js';

// Mock logger for testing
const mockLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

// Mock repository for testing
function createMockRepository(prompts: Prompt[] = []): PromptRepository {
  const storage = new Map(prompts.map((p) => [p.id, p]));

  return {
    createPrompt: (
      _userId: string,
      data: { title: string; content: string }
    ): Promise<Result<Prompt, PromptVaultError>> => {
      const prompt: Prompt = {
        id: 'new-prompt-id',
        title: data.title,
        content: data.content,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      storage.set(prompt.id, prompt);
      return Promise.resolve(ok(prompt));
    },
    getPrompt: (_userId: string, promptId: string): Promise<Result<Prompt, PromptVaultError>> => {
      const prompt = storage.get(promptId);
      if (prompt === undefined) {
        return Promise.resolve(err({ code: 'NOT_FOUND' as const, message: 'Prompt not found' }));
      }
      return Promise.resolve(ok(prompt));
    },
    listPrompts: (_userId: string): Promise<Result<Prompt[], PromptVaultError>> => {
      return Promise.resolve(ok(Array.from(storage.values())));
    },
    updatePrompt: (
      _userId: string,
      promptId: string,
      data: { title?: string; content?: string }
    ): Promise<Result<Prompt, PromptVaultError>> => {
      const prompt = storage.get(promptId);
      if (prompt === undefined) {
        return Promise.resolve(err({ code: 'NOT_FOUND' as const, message: 'Prompt not found' }));
      }
      const updated: Prompt = {
        ...prompt,
        title: data.title ?? prompt.title,
        content: data.content ?? prompt.content,
        updatedAt: new Date().toISOString(),
      };
      storage.set(promptId, updated);
      return Promise.resolve(ok(updated));
    },
  };
}
describe('createPrompt use case', () => {
  it('creates a prompt with valid input', async () => {
    const repo = createMockRepository();
    const result = await createPrompt(repo, {
      userId: 'user-1',
      title: 'Test Prompt',
      content: 'Test content',
    }, { logger: mockLogger });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe('Test Prompt');
      expect(result.value.content).toBe('Test content');
    }
  });
  it('returns error when title is empty', async () => {
    const repo = createMockRepository();
    const result = await createPrompt(repo, {
      userId: 'user-1',
      title: '',
      content: 'Test content',
    }, { logger: mockLogger });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('VALIDATION_ERROR');
    }
  });
  it('returns error when title is whitespace only', async () => {
    const repo = createMockRepository();
    const result = await createPrompt(repo, {
      userId: 'user-1',
      title: '   ',
      content: 'Test content',
    }, { logger: mockLogger });
    expect(isErr(result)).toBe(true);
  });
  it('returns error when content is empty', async () => {
    const repo = createMockRepository();
    const result = await createPrompt(repo, {
      userId: 'user-1',
      title: 'Test Title',
      content: '',
    }, { logger: mockLogger });
    expect(isErr(result)).toBe(true);
  });
  it('returns error when title exceeds max length', async () => {
    const repo = createMockRepository();
    const result = await createPrompt(repo, {
      userId: 'user-1',
      title: 'a'.repeat(201),
      content: 'Test content',
    }, { logger: mockLogger });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('200');
    }
  });
  it('returns error when content exceeds max length', async () => {
    const repo = createMockRepository();
    const result = await createPrompt(repo, {
      userId: 'user-1',
      title: 'Test Title',
      content: 'a'.repeat(100001),
    }, { logger: mockLogger });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('VALIDATION_ERROR');
      expect(result.error.message).toContain('100000');
    }
  });
  it('returns error when content is whitespace only', async () => {
    const repo = createMockRepository();
    const result = await createPrompt(repo, {
      userId: 'user-1',
      title: 'Test Title',
      content: '   ',
    }, { logger: mockLogger });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('VALIDATION_ERROR');
    }
  });
});
describe('getPrompt use case', () => {
  it('returns prompt when found', async () => {
    const repo = createMockRepository([
      {
        id: 'prompt-1',
        title: 'Test',
        content: 'Content',
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
      },
    ]);
    const result = await getPrompt(repo, { userId: 'user-1', promptId: 'prompt-1' }, { logger: mockLogger });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe('prompt-1');
    }
  });
  it('returns error when not found', async () => {
    const repo = createMockRepository();
    const result = await getPrompt(repo, { userId: 'user-1', promptId: 'nonexistent' }, { logger: mockLogger });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });
  it('returns error when promptId is empty', async () => {
    const repo = createMockRepository();
    const result = await getPrompt(repo, { userId: 'user-1', promptId: '' }, { logger: mockLogger });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('VALIDATION_ERROR');
      expect(result.error.message).toContain('promptId');
    }
  });
  it('returns error when promptId is whitespace only', async () => {
    const repo = createMockRepository();
    const result = await getPrompt(repo, { userId: 'user-1', promptId: '   ' }, { logger: mockLogger });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('VALIDATION_ERROR');
    }
  });
});
describe('listPrompts use case', () => {
  it('returns empty array when no prompts', async () => {
    const repo = createMockRepository();
    const result = await listPrompts(repo, { userId: 'user-1' }, { logger: mockLogger });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([]);
    }
  });
  it('returns all prompts', async () => {
    const repo = createMockRepository([
      { id: 'p1', title: 'P1', content: 'C1', createdAt: '', updatedAt: '' },
      { id: 'p2', title: 'P2', content: 'C2', createdAt: '', updatedAt: '' },
    ]);
    const result = await listPrompts(repo, { userId: 'user-1' }, { logger: mockLogger });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
    }
  });
});
describe('updatePrompt use case', () => {
  it('updates prompt with valid input', async () => {
    const repo = createMockRepository([
      { id: 'p1', title: 'Old', content: 'Old', createdAt: '', updatedAt: '' },
    ]);
    const result = await updatePrompt(repo, {
      userId: 'user-1',
      promptId: 'p1',
      title: 'New Title',
    }, { logger: mockLogger });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe('New Title');
    }
  });
  it('returns error when prompt not found', async () => {
    const repo = createMockRepository();
    const result = await updatePrompt(repo, {
      userId: 'user-1',
      promptId: 'nonexistent',
      title: 'New Title',
    }, { logger: mockLogger });
    expect(isErr(result)).toBe(true);
  });
  it('returns error when title is empty', async () => {
    const repo = createMockRepository([
      { id: 'p1', title: 'Old', content: 'Old', createdAt: '', updatedAt: '' },
    ]);
    const result = await updatePrompt(repo, {
      userId: 'user-1',
      promptId: 'p1',
      title: '',
    }, { logger: mockLogger });
    expect(isErr(result)).toBe(true);
  });
  it('returns error when promptId is empty', async () => {
    const repo = createMockRepository([
      { id: 'p1', title: 'Old', content: 'Old', createdAt: '', updatedAt: '' },
    ]);
    const result = await updatePrompt(repo, {
      userId: 'user-1',
      promptId: '',
      title: 'New Title',
    }, { logger: mockLogger });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('VALIDATION_ERROR');
    }
  });
  it('returns error when neither title nor content provided', async () => {
    const repo = createMockRepository([
      { id: 'p1', title: 'Old', content: 'Old', createdAt: '', updatedAt: '' },
    ]);
    const result = await updatePrompt(repo, {
      userId: 'user-1',
      promptId: 'p1',
    }, { logger: mockLogger });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('VALIDATION_ERROR');
      expect(result.error.message).toContain('at least one');
    }
  });
  it('returns error when title exceeds max length', async () => {
    const repo = createMockRepository([
      { id: 'p1', title: 'Old', content: 'Old', createdAt: '', updatedAt: '' },
    ]);
    const result = await updatePrompt(repo, {
      userId: 'user-1',
      promptId: 'p1',
      title: 'a'.repeat(201),
    }, { logger: mockLogger });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('VALIDATION_ERROR');
      expect(result.error.message).toContain('200');
    }
  });
  it('returns error when content is empty', async () => {
    const repo = createMockRepository([
      { id: 'p1', title: 'Old', content: 'Old', createdAt: '', updatedAt: '' },
    ]);
    const result = await updatePrompt(repo, {
      userId: 'user-1',
      promptId: 'p1',
      content: '',
    }, { logger: mockLogger });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('VALIDATION_ERROR');
    }
  });
  it('returns error when content is whitespace only', async () => {
    const repo = createMockRepository([
      { id: 'p1', title: 'Old', content: 'Old', createdAt: '', updatedAt: '' },
    ]);
    const result = await updatePrompt(repo, {
      userId: 'user-1',
      promptId: 'p1',
      content: '   ',
    }, { logger: mockLogger });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('VALIDATION_ERROR');
    }
  });
  it('returns error when content exceeds max length', async () => {
    const repo = createMockRepository([
      { id: 'p1', title: 'Old', content: 'Old', createdAt: '', updatedAt: '' },
    ]);
    const result = await updatePrompt(repo, {
      userId: 'user-1',
      promptId: 'p1',
      content: 'a'.repeat(100001),
    }, { logger: mockLogger });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('VALIDATION_ERROR');
      expect(result.error.message).toContain('100000');
    }
  });
  it('updates prompt with only content', async () => {
    const repo = createMockRepository([
      { id: 'p1', title: 'Old', content: 'Old', createdAt: '', updatedAt: '' },
    ]);
    const result = await updatePrompt(repo, {
      userId: 'user-1',
      promptId: 'p1',
      content: 'New Content',
    }, { logger: mockLogger });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.content).toBe('New Content');
    }
  });
  it('updates prompt with both title and content', async () => {
    const repo = createMockRepository([
      { id: 'p1', title: 'Old', content: 'Old', createdAt: '', updatedAt: '' },
    ]);
    const result = await updatePrompt(repo, {
      userId: 'user-1',
      promptId: 'p1',
      title: 'New Title',
      content: 'New Content',
    }, { logger: mockLogger });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe('New Title');
      expect(result.value.content).toBe('New Content');
    }
  });
  it('returns error when title is whitespace only', async () => {
    const repo = createMockRepository([
      { id: 'p1', title: 'Old', content: 'Old', createdAt: '', updatedAt: '' },
    ]);
    const result = await updatePrompt(repo, {
      userId: 'user-1',
      promptId: 'p1',
      title: '   ',
    }, { logger: mockLogger });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('VALIDATION_ERROR');
    }
  });
});
describe('factory functions', () => {
  describe('createCreatePromptUseCase', () => {
    it('creates a bound use case that works like the original', async () => {
      const repo = createMockRepository();
      const boundCreatePrompt = createCreatePromptUseCase(repo, mockLogger);
      const result = await boundCreatePrompt({
        userId: 'user-1',
        title: 'Factory Test',
        content: 'Content',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Factory Test');
      }
    });
  });
  describe('createGetPromptUseCase', () => {
    it('creates a bound use case that works like the original', async () => {
      const repo = createMockRepository([
        { id: 'p1', title: 'Test', content: 'C', createdAt: '', updatedAt: '' },
      ]);
      const boundGetPrompt = createGetPromptUseCase(repo, mockLogger);
      const result = await boundGetPrompt({ userId: 'user-1', promptId: 'p1' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('p1');
      }
    });
  });
  describe('createListPromptsUseCase', () => {
    it('creates a bound use case that works like the original', async () => {
      const repo = createMockRepository([
        { id: 'p1', title: 'P1', content: 'C1', createdAt: '', updatedAt: '' },
      ]);
      const boundListPrompts = createListPromptsUseCase(repo, mockLogger);
      const result = await boundListPrompts({ userId: 'user-1' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
      }
    });
  });
  describe('createUpdatePromptUseCase', () => {
    it('creates a bound use case that works like the original', async () => {
      const repo = createMockRepository([
        { id: 'p1', title: 'Old', content: 'Old', createdAt: '', updatedAt: '' },
      ]);
      const boundUpdatePrompt = createUpdatePromptUseCase(repo, mockLogger);
      const result = await boundUpdatePrompt({
        userId: 'user-1',
        promptId: 'p1',
        title: 'Updated',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Updated');
      }
    });
  });
});
