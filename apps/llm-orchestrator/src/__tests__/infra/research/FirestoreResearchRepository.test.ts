/**
 * Tests for FirestoreResearchRepository.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

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
        prompt: 'Test prompt',
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
      const researches = [
        { id: 'research-1', userId: 'user-1' },
        { id: 'research-2', userId: 'user-1' },
      ];

      const mockQueryGet = vi.fn().mockResolvedValue({
        docs: researches.map((r) => ({ id: r.id, data: () => r })),
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
      const updatedResearch = { id: 'research-1', title: 'New Title' };
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
  });

  describe('updateLlmResult', () => {
    it('updates specific LLM result', async () => {
      const research = {
        id: 'research-1',
        llmResults: [
          { provider: 'google', status: 'pending' },
          { provider: 'anthropic', status: 'pending' },
        ],
      };
      mockDocGet.mockResolvedValue({ exists: true, data: () => research });
      mockDocUpdate.mockResolvedValue(undefined);

      const mockDocRef = { get: mockDocGet, update: mockDocUpdate };
      mockDoc.mockReturnValue(mockDocRef);

      const result = await repository.updateLlmResult('research-1', 'google', {
        status: 'completed',
        content: 'Result content',
      });

      expect(result.ok).toBe(true);
      expect(mockDocUpdate).toHaveBeenCalledWith({
        llmResults: [
          { provider: 'google', status: 'completed', content: 'Result content' },
          { provider: 'anthropic', status: 'pending' },
        ],
      });
    });

    it('returns NOT_FOUND when research does not exist', async () => {
      mockDocGet.mockResolvedValue({ exists: false });

      const result = await repository.updateLlmResult('nonexistent', 'google', {
        status: 'completed',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
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

  describe('custom collection name', () => {
    it('uses custom collection name when provided', async () => {
      const customRepo = new FirestoreResearchRepository('custom_researches');
      mockDocGet.mockResolvedValue({ exists: true, data: () => ({}) });

      await customRepo.findById('research-1');

      expect(mockCollection).toHaveBeenCalledWith('custom_researches');
    });
  });
});
