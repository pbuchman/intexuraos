/**
 * Tests for research usecases.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';
import type { Research } from '../domain/research/index.js';
import {
  deleteResearch,
  getResearch,
  listResearches,
  submitResearch,
} from '../domain/research/index.js';
import { FakeResearchRepository } from './fakes.js';

function createSilentLogger(): ReturnType<typeof vi.fn> & {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
} {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as ReturnType<typeof vi.fn> & {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
  };
}

function createTestResearch(overrides?: Partial<Research>): Research {
  return {
    id: 'test-research-123',
    userId: 'user-123',
    title: '',
    prompt: 'Test prompt',
    selectedModels: [LlmModels.Gemini25Pro],
    synthesisModel: LlmModels.Gemini25Pro,
    status: 'pending',
    llmResults: [
      {
        provider: LlmProviders.Google,
        model: 'gemini-2.0-flash-exp',
        status: 'pending',
      },
    ],
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('submitResearch', () => {
  let fakeRepo: FakeResearchRepository;

  beforeEach(() => {
    fakeRepo = new FakeResearchRepository();
  });

  it('creates research with correct initial state', async () => {
    const result = await submitResearch(
      {
        userId: 'user-123',
        prompt: 'Test research prompt',
        selectedModels: [LlmModels.Gemini25Pro, LlmModels.ClaudeOpus45],
        synthesisModel: LlmModels.Gemini25Pro,
      },
      {
        researchRepo: fakeRepo,
        generateId: (): string => 'generated-id-123',
        logger: createSilentLogger() as unknown as Parameters<typeof submitResearch>[1]['logger'],
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe('generated-id-123');
      expect(result.value.userId).toBe('user-123');
      expect(result.value.prompt).toBe('Test research prompt');
      expect(result.value.status).toBe('pending');
      expect(result.value.selectedModels).toEqual([LlmModels.Gemini25Pro, LlmModels.ClaudeOpus45]);
      expect(result.value.llmResults).toHaveLength(2);
    }
  });

  it('initializes LLM results correctly', async () => {
    const result = await submitResearch(
      {
        userId: 'user-123',
        prompt: 'Test prompt',
        selectedModels: [
          LlmModels.Gemini25Pro,
          LlmModels.O4MiniDeepResearch,
          LlmModels.ClaudeOpus45,
        ],
        synthesisModel: LlmModels.Gemini25Pro,
      },
      {
        researchRepo: fakeRepo,
        generateId: (): string => 'id-123',
        logger: createSilentLogger() as unknown as Parameters<typeof submitResearch>[1]['logger'],
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.llmResults).toHaveLength(3);
      expect(result.value.llmResults[0]?.provider).toBe(LlmProviders.Google);
      expect(result.value.llmResults[0]?.status).toBe('pending');
      expect(result.value.llmResults[1]?.provider).toBe(LlmProviders.OpenAI);
      expect(result.value.llmResults[2]?.provider).toBe(LlmProviders.Anthropic);
    }
  });

  it('returns error on save failure', async () => {
    fakeRepo.setFailNextSave(true);

    const result = await submitResearch(
      {
        userId: 'user-123',
        prompt: 'Test prompt',
        selectedModels: [LlmModels.Gemini25Pro],
        synthesisModel: LlmModels.Gemini25Pro,
      },
      {
        researchRepo: fakeRepo,
        generateId: (): string => 'id-123',
        logger: createSilentLogger() as unknown as Parameters<typeof submitResearch>[1]['logger'],
      }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Test save failure');
    }
  });

  it('sets skipSynthesis when provided', async () => {
    const result = await submitResearch(
      {
        userId: 'user-123',
        prompt: 'Test prompt',
        selectedModels: [LlmModels.Gemini25Pro],
        synthesisModel: LlmModels.Gemini25Pro,
        skipSynthesis: true,
      },
      {
        researchRepo: fakeRepo,
        generateId: (): string => 'id-123',
        logger: createSilentLogger() as unknown as Parameters<typeof submitResearch>[1]['logger'],
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.skipSynthesis).toBe(true);
    }
  });

  it('passes selectedModels to research creation', async () => {
    const result = await submitResearch(
      {
        userId: 'user-123',
        prompt: 'Test prompt',
        selectedModels: [LlmModels.ClaudeOpus45],
        synthesisModel: LlmModels.Gemini25Pro,
      },
      {
        researchRepo: fakeRepo,
        generateId: (): string => 'id-123',
        logger: createSilentLogger() as unknown as Parameters<typeof submitResearch>[1]['logger'],
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.llmResults[0]?.model).toBe(LlmModels.ClaudeOpus45);
    }
  });
});

describe('getResearch', () => {
  let fakeRepo: FakeResearchRepository;

  beforeEach(() => {
    fakeRepo = new FakeResearchRepository();
  });

  it('returns research when found', async () => {
    const research = createTestResearch();
    fakeRepo.addResearch(research);

    const result = await getResearch(research.id, { researchRepo: fakeRepo });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(research);
    }
  });

  it('returns null when not found', async () => {
    const result = await getResearch('nonexistent', { researchRepo: fakeRepo });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeNull();
    }
  });

  it('returns error on find failure', async () => {
    fakeRepo.setFailNextFind(true);

    const result = await getResearch('any-id', { researchRepo: fakeRepo });

    expect(result.ok).toBe(false);
  });
});

describe('listResearches', () => {
  let fakeRepo: FakeResearchRepository;

  beforeEach(() => {
    fakeRepo = new FakeResearchRepository();
  });

  it('returns empty list when no researches', async () => {
    const result = await listResearches({ userId: 'user-123' }, { researchRepo: fakeRepo });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items).toEqual([]);
    }
  });

  it('returns user researches', async () => {
    fakeRepo.addResearch(createTestResearch({ id: 'r1', userId: 'user-123' }));
    fakeRepo.addResearch(createTestResearch({ id: 'r2', userId: 'user-123' }));
    fakeRepo.addResearch(createTestResearch({ id: 'r3', userId: 'other-user' }));

    const result = await listResearches({ userId: 'user-123' }, { researchRepo: fakeRepo });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items).toHaveLength(2);
    }
  });

  it('respects limit parameter', async () => {
    fakeRepo.addResearch(createTestResearch({ id: 'r1', userId: 'user-123' }));
    fakeRepo.addResearch(createTestResearch({ id: 'r2', userId: 'user-123' }));
    fakeRepo.addResearch(createTestResearch({ id: 'r3', userId: 'user-123' }));

    const result = await listResearches(
      { userId: 'user-123', limit: 2 },
      { researchRepo: fakeRepo }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items).toHaveLength(2);
    }
  });

  it('returns error on find failure', async () => {
    fakeRepo.setFailNextFind(true);

    const result = await listResearches({ userId: 'user-123' }, { researchRepo: fakeRepo });

    expect(result.ok).toBe(false);
  });

  it('passes cursor parameter to repository', async () => {
    fakeRepo.addResearch(createTestResearch({ id: 'r1', userId: 'user-123' }));

    const result = await listResearches(
      { userId: 'user-123', cursor: 'some-cursor' },
      { researchRepo: fakeRepo }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items).toHaveLength(1);
    }
  });
});

describe('deleteResearch', () => {
  let fakeRepo: FakeResearchRepository;

  beforeEach(() => {
    fakeRepo = new FakeResearchRepository();
  });

  it('deletes research', async () => {
    const research = createTestResearch();
    fakeRepo.addResearch(research);

    const result = await deleteResearch(research.id, { researchRepo: fakeRepo });

    expect(result.ok).toBe(true);
    expect(fakeRepo.getAll()).toHaveLength(0);
  });

  it('returns error on delete failure', async () => {
    fakeRepo.setFailNextDelete(true);

    const result = await deleteResearch('any-id', { researchRepo: fakeRepo });

    expect(result.ok).toBe(false);
  });
});
