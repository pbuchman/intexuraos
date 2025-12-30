/**
 * Tests for research usecases.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  submitResearch,
  getResearch,
  listResearches,
  deleteResearch,
} from '../domain/research/index.js';
import { FakeResearchRepository } from './fakes.js';
import type { Research } from '../domain/research/index.js';

function createTestResearch(overrides?: Partial<Research>): Research {
  return {
    id: 'test-research-123',
    userId: 'user-123',
    title: '',
    prompt: 'Test prompt',
    selectedLlms: ['google'],
    synthesisLlm: 'google',
    status: 'pending',
    llmResults: [
      {
        provider: 'google',
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
        selectedLlms: ['google', 'anthropic'],
        synthesisLlm: 'google',
      },
      {
        researchRepo: fakeRepo,
        generateId: (): string => 'generated-id-123',
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe('generated-id-123');
      expect(result.value.userId).toBe('user-123');
      expect(result.value.prompt).toBe('Test research prompt');
      expect(result.value.status).toBe('pending');
      expect(result.value.selectedLlms).toEqual(['google', 'anthropic']);
      expect(result.value.llmResults).toHaveLength(2);
    }
  });

  it('initializes LLM results correctly', async () => {
    const result = await submitResearch(
      {
        userId: 'user-123',
        prompt: 'Test prompt',
        selectedLlms: ['google', 'openai', 'anthropic'],
        synthesisLlm: 'google',
      },
      {
        researchRepo: fakeRepo,
        generateId: (): string => 'id-123',
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.llmResults).toHaveLength(3);
      expect(result.value.llmResults[0]?.provider).toBe('google');
      expect(result.value.llmResults[0]?.status).toBe('pending');
      expect(result.value.llmResults[1]?.provider).toBe('openai');
      expect(result.value.llmResults[2]?.provider).toBe('anthropic');
    }
  });

  it('returns error on save failure', async () => {
    fakeRepo.setFailNextSave(true);

    const result = await submitResearch(
      {
        userId: 'user-123',
        prompt: 'Test prompt',
        selectedLlms: ['google'],
        synthesisLlm: 'google',
      },
      {
        researchRepo: fakeRepo,
        generateId: (): string => 'id-123',
      }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Test save failure');
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
