/**
 * Tests for FirestoreResearchRepository.
 */

import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Research } from '../../../domain/research/index.js';

const mockDocSet = vi.fn().mockResolvedValue(undefined);
const mockDocGet = vi.fn();
const mockDocUpdate = vi.fn().mockResolvedValue(undefined);
const mockDocDelete = vi.fn().mockResolvedValue(undefined);

const mockDoc = vi.fn().mockReturnValue({
  set: mockDocSet,
  get: mockDocGet,
  update: mockDocUpdate,
  delete: mockDocDelete,
});

const mockWhere = vi.fn();
const mockCollection = vi.fn().mockReturnValue({
  doc: mockDoc,
  where: mockWhere,
});

const mockGetFirestore = vi.fn().mockReturnValue({
  collection: mockCollection,
});

vi.mock('@intexuraos/infra-firestore', () => ({
  getFirestore: mockGetFirestore,
  FieldValue: {
    delete: vi.fn().mockReturnValue({ _methodName: 'FieldValue.delete' }),
  },
}));

const { FirestoreResearchRepository } =
  await import('../../../infra/research/FirestoreResearchRepository.js');

describe('FirestoreResearchRepository', () => {
  let repository: InstanceType<typeof FirestoreResearchRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new FirestoreResearchRepository();
  });

  describe('save', () => {
    it('saves research to Firestore', async () => {
      const research = {
        id: 'research-1',
        userId: 'user-1',
        title: 'Test Research',
        prompt: 'Test prompt',
        selectedModels: [LlmModels.Gemini25Pro as const],
        synthesisModel: LlmModels.Gemini25Pro as const,
        status: 'pending' as const,
        llmResults: [],
        startedAt: '2024-01-01T00:00:00Z',
      };

      const result = await repository.save(research);

      expect(result.ok).toBe(true);
      expect(mockCollection).toHaveBeenCalledWith('researches');
      expect(mockDoc).toHaveBeenCalledWith('research-1');
      expect(mockDocSet).toHaveBeenCalledWith(research);
    });

    it('returns error on Firestore failure', async () => {
      mockDocSet.mockRejectedValueOnce(new Error('Connection failed'));

      const research = { id: 'research-1', userId: 'user-1' };
      const result = await repository.save(research as never);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FIRESTORE_ERROR');
      }
    });
  });

  describe('findById', () => {
    it('returns research when found', async () => {
      const research = { id: 'research-1', prompt: 'Test' };
      mockDocGet.mockResolvedValue({ exists: true, data: () => research });

      const result = await repository.findById('research-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(research);
      }
    });

    it('returns null when not found', async () => {
      mockDocGet.mockResolvedValue({ exists: false });

      const result = await repository.findById('nonexistent');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns error on Firestore failure', async () => {
      mockDocGet.mockRejectedValueOnce(new Error('Connection failed'));

      const result = await repository.findById('research-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FIRESTORE_ERROR');
      }
    });
  });

  describe('findByUserId', () => {
    it('returns researches for user', async () => {
      const researches: Research[] = [
        {
          id: 'research-1',
          userId: 'user-1',
          title: 'Test Research 1',
          prompt: 'Test',
          selectedModels: [LlmModels.Gemini25Pro],
          synthesisModel: LlmModels.Gemini25Pro,
          status: 'pending',
          llmResults: [],
          startedAt: '2024-01-01T00:00:00Z',
        },
        {
          id: 'research-2',
          userId: 'user-1',
          title: 'Test Research 2',
          prompt: 'Test',
          selectedModels: [LlmModels.Gemini25Pro],
          synthesisModel: LlmModels.Gemini25Pro,
          status: 'pending',
          llmResults: [],
          startedAt: '2024-01-01T00:00:00Z',
        },
      ];

      const mockQueryGet = vi.fn().mockResolvedValue({
        docs: researches.map((r): { id: string; data: () => Research } => ({
          id: r.id,
          data: () => r,
        })),
      });

      mockWhere.mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            get: mockQueryGet,
          }),
        }),
      });

      const result = await repository.findByUserId('user-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.items).toHaveLength(2);
        expect(result.value.nextCursor).toBe('research-2');
      }
    });

    it('returns empty list when no results', async () => {
      mockWhere.mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({ docs: [] }),
          }),
        }),
      });

      const result = await repository.findByUserId('user-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.items).toHaveLength(0);
        expect(result.value.nextCursor).toBeUndefined();
      }
    });

    it('handles cursor pagination', async () => {
      const cursorDoc = { exists: true };
      mockDocGet.mockResolvedValue(cursorDoc);

      const mockStartAfter = vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({ docs: [] }),
      });

      mockWhere.mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            startAfter: mockStartAfter,
          }),
        }),
      });

      await repository.findByUserId('user-1', { cursor: 'prev-id' });

      expect(mockStartAfter).toHaveBeenCalledWith(cursorDoc);
    });

    it('ignores invalid cursor', async () => {
      mockDocGet.mockResolvedValue({ exists: false });

      mockWhere.mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({ docs: [] }),
          }),
        }),
      });

      const result = await repository.findByUserId('user-1', { cursor: 'invalid' });

      expect(result.ok).toBe(true);
    });

    it('returns error on Firestore failure', async () => {
      mockWhere.mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            get: vi.fn().mockRejectedValue(new Error('Query failed')),
          }),
        }),
      });

      const result = await repository.findByUserId('user-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FIRESTORE_ERROR');
      }
    });
  });

  describe('update', () => {
    it('updates research in Firestore', async () => {
      const updatedResearch: Research = {
        id: 'research-1',
        userId: 'user-1',
        title: 'New Title',
        prompt: 'Test',
        selectedModels: [LlmModels.Gemini25Pro],
        synthesisModel: LlmModels.Gemini25Pro,
        status: 'pending',
        llmResults: [],
        startedAt: '2024-01-01T00:00:00Z',
      };
      mockDocUpdate.mockResolvedValue(undefined);
      mockDocGet.mockResolvedValue({ exists: true, data: () => updatedResearch });

      const result = await repository.update('research-1', { title: 'New Title' });

      expect(result.ok).toBe(true);
      expect(mockDocUpdate).toHaveBeenCalledWith({ title: 'New Title' });
    });

    it('returns NOT_FOUND if research does not exist after update', async () => {
      mockDocUpdate.mockResolvedValue(undefined);
      mockDocGet.mockResolvedValue({ exists: false });

      const result = await repository.update('nonexistent', { title: 'New Title' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('returns error on Firestore failure', async () => {
      mockDocUpdate.mockRejectedValueOnce(new Error('Update failed'));

      const result = await repository.update('research-1', { title: 'New Title' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FIRESTORE_ERROR');
      }
    });

    it('propagates findById error after successful update', async () => {
      mockDocUpdate.mockResolvedValue(undefined);
      mockDocGet.mockRejectedValueOnce(new Error('Read failed after update'));

      const result = await repository.update('research-1', { title: 'New Title' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FIRESTORE_ERROR');
      }
    });
  });

  describe('updateLlmResult', () => {
    it('updates specific LLM result', async () => {
      const research: Research = {
        id: 'research-1',
        userId: 'user-1',
        title: 'Test Research',
        prompt: 'Test',
        selectedModels: [LlmModels.Gemini25Pro, LlmModels.ClaudeOpus45],
        synthesisModel: LlmModels.Gemini25Pro,
        status: 'pending',
        llmResults: [
          { provider: LlmProviders.Google, model: LlmModels.Gemini25Pro, status: 'pending' },
          { provider: LlmProviders.Anthropic, model: LlmModels.ClaudeOpus45, status: 'pending' },
        ],
        startedAt: '2024-01-01T00:00:00Z',
      };
      mockDocGet.mockResolvedValue({ exists: true, data: () => research });
      mockDocUpdate.mockResolvedValue(undefined);

      const mockDocRef = { get: mockDocGet, update: mockDocUpdate };
      mockDoc.mockReturnValue(mockDocRef);

      const result = await repository.updateLlmResult('research-1', LlmModels.Gemini25Pro, {
        status: 'completed',
        result: 'Result content',
      });

      expect(result.ok).toBe(true);
      expect(mockDocUpdate).toHaveBeenCalledWith({
        llmResults: [
          {
            provider: LlmProviders.Google,
            model: LlmModels.Gemini25Pro,
            status: 'completed',
            result: 'Result content',
          },
          { provider: LlmProviders.Anthropic, model: LlmModels.ClaudeOpus45, status: 'pending' },
        ],
      });
    });

    it('returns NOT_FOUND when research does not exist', async () => {
      mockDocGet.mockResolvedValue({ exists: false });

      const result = await repository.updateLlmResult('nonexistent', LlmModels.Gemini20Flash, {
        status: 'completed',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('clears error field when status is set to pending', async () => {
      const research: Research = {
        id: 'research-1',
        userId: 'user-1',
        title: 'Test Research',
        prompt: 'Test',
        selectedModels: [LlmModels.Gemini25Pro],
        synthesisModel: LlmModels.Gemini25Pro,
        status: 'failed',
        llmResults: [
          { provider: LlmProviders.Google, model: LlmModels.Gemini20Flash, status: 'failed', error: 'Rate limit' },
        ],
        startedAt: '2024-01-01T00:00:00Z',
      };
      mockDocGet.mockResolvedValue({ exists: true, data: () => research });
      mockDocUpdate.mockResolvedValue(undefined);

      const mockDocRef = { get: mockDocGet, update: mockDocUpdate };
      mockDoc.mockReturnValue(mockDocRef);

      const result = await repository.updateLlmResult('research-1', LlmModels.Gemini20Flash, {
        status: 'pending',
      });

      expect(result.ok).toBe(true);
      expect(mockDocUpdate).toHaveBeenCalledWith({
        llmResults: [
          {
            provider: LlmProviders.Google,
            model: LlmModels.Gemini20Flash,
            status: 'pending',
          },
        ],
      });
    });

    it('clears error field when status is set to processing', async () => {
      const research: Research = {
        id: 'research-1',
        userId: 'user-1',
        title: 'Test Research',
        prompt: 'Test',
        selectedModels: [LlmModels.Gemini25Pro],
        synthesisModel: LlmModels.Gemini25Pro,
        status: 'retrying',
        llmResults: [
          { provider: LlmProviders.Google, model: LlmModels.Gemini20Flash, status: 'failed', error: 'Rate limit' },
        ],
        startedAt: '2024-01-01T00:00:00Z',
      };
      mockDocGet.mockResolvedValue({ exists: true, data: () => research });
      mockDocUpdate.mockResolvedValue(undefined);

      const mockDocRef = { get: mockDocGet, update: mockDocUpdate };
      mockDoc.mockReturnValue(mockDocRef);

      const result = await repository.updateLlmResult('research-1', LlmModels.Gemini20Flash, {
        status: 'processing',
      });

      expect(result.ok).toBe(true);
      expect(mockDocUpdate).toHaveBeenCalledWith({
        llmResults: [
          {
            provider: LlmProviders.Google,
            model: LlmModels.Gemini20Flash,
            status: 'processing',
          },
        ],
      });
    });

    it('preserves error field when status is not pending or processing', async () => {
      const research: Research = {
        id: 'research-1',
        userId: 'user-1',
        title: 'Test Research',
        prompt: 'Test',
        selectedModels: [LlmModels.Gemini25Pro],
        synthesisModel: LlmModels.Gemini25Pro,
        status: 'processing',
        llmResults: [{ provider: LlmProviders.Google, model: LlmModels.Gemini20Flash, status: 'processing' }],
        startedAt: '2024-01-01T00:00:00Z',
      };
      mockDocGet.mockResolvedValue({ exists: true, data: () => research });
      mockDocUpdate.mockResolvedValue(undefined);

      const mockDocRef = { get: mockDocGet, update: mockDocUpdate };
      mockDoc.mockReturnValue(mockDocRef);

      const result = await repository.updateLlmResult('research-1', LlmModels.Gemini20Flash, {
        status: 'failed',
        error: 'New error',
      });

      expect(result.ok).toBe(true);
      expect(mockDocUpdate).toHaveBeenCalledWith({
        llmResults: [
          {
            provider: LlmProviders.Google,
            model: LlmModels.Gemini20Flash,
            status: 'failed',
            error: 'New error',
          },
        ],
      });
    });

    it('returns error on Firestore failure', async () => {
      const research: Research = {
        id: 'research-1',
        userId: 'user-1',
        title: 'Test Research',
        prompt: 'Test',
        selectedModels: [LlmModels.Gemini25Pro],
        synthesisModel: LlmModels.Gemini25Pro,
        status: 'processing',
        llmResults: [{ provider: LlmProviders.Google, model: LlmModels.Gemini20Flash, status: 'processing' }],
        startedAt: '2024-01-01T00:00:00Z',
      };
      mockDocGet.mockResolvedValue({ exists: true, data: () => research });
      mockDocUpdate.mockRejectedValueOnce(new Error('Update failed'));

      const mockDocRef = { get: mockDocGet, update: mockDocUpdate };
      mockDoc.mockReturnValue(mockDocRef);

      const result = await repository.updateLlmResult('research-1', LlmModels.Gemini20Flash, {
        status: 'completed',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FIRESTORE_ERROR');
      }
    });
  });

  describe('delete', () => {
    it('deletes research from Firestore', async () => {
      mockDoc.mockReturnValue({
        set: mockDocSet,
        get: mockDocGet,
        update: mockDocUpdate,
        delete: mockDocDelete,
      });

      const result = await repository.delete('research-1');

      expect(result.ok).toBe(true);
      expect(mockDocDelete).toHaveBeenCalled();
    });

    it('returns error on Firestore failure', async () => {
      mockDoc.mockReturnValue({
        set: mockDocSet,
        get: mockDocGet,
        update: mockDocUpdate,
        delete: vi.fn().mockRejectedValueOnce(new Error('Delete failed')),
      });

      const result = await repository.delete('research-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FIRESTORE_ERROR');
      }
    });
  });

  describe('clearShareInfo', () => {
    it('clears share info and returns updated research', async () => {
      const updatedResearch: Research = {
        id: 'research-1',
        userId: 'user-1',
        title: 'Test Research',
        prompt: 'Test',
        selectedModels: [LlmModels.Gemini25Pro],
        synthesisModel: LlmModels.Gemini25Pro,
        status: 'completed',
        llmResults: [],
        startedAt: '2024-01-01T00:00:00Z',
      };
      mockDocUpdate.mockResolvedValue(undefined);
      mockDocGet.mockResolvedValue({ exists: true, data: () => updatedResearch });

      const result = await repository.clearShareInfo('research-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('research-1');
      }
      expect(mockDocUpdate).toHaveBeenCalled();
    });

    it('returns NOT_FOUND if research does not exist after clearing', async () => {
      mockDocUpdate.mockResolvedValue(undefined);
      mockDocGet.mockResolvedValue({ exists: false });

      const result = await repository.clearShareInfo('nonexistent');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('propagates findById error after clearing', async () => {
      mockDocUpdate.mockResolvedValue(undefined);
      mockDocGet.mockRejectedValueOnce(new Error('Read failed'));

      const result = await repository.clearShareInfo('research-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FIRESTORE_ERROR');
      }
    });

    it('returns error on Firestore update failure', async () => {
      mockDocUpdate.mockRejectedValueOnce(new Error('Update failed'));

      const result = await repository.clearShareInfo('research-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FIRESTORE_ERROR');
      }
    });
  });

  describe('custom collection name', () => {
    it('uses custom collection name when provided', async () => {
      const customRepo = new FirestoreResearchRepository('custom_researches');
      mockDocGet.mockResolvedValue({ exists: true, data: () => ({}) });

      await customRepo.findById('research-1');

      expect(mockCollection).toHaveBeenCalledWith('custom_researches');
    });
  });
});
