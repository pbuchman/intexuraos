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
        selectedModels: [LlmModels.Gemini25Pro],
        synthesisModel: LlmModels.Gemini25Pro,
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
    it('returns researches for user with favorites first', async () => {
      const favoriteResearch: Research = {
        id: 'research-fav',
        userId: 'user-1',
        title: 'Favorite Research',
        prompt: 'Test',
        selectedModels: [LlmModels.Gemini25Pro],
        synthesisModel: LlmModels.Gemini25Pro,
        status: 'pending',
        llmResults: [],
        favourite: true,
        startedAt: '2024-01-02T00:00:00Z',
      };
      const normalResearch: Research = {
        id: 'research-2',
        userId: 'user-1',
        title: 'Test Research 2',
        prompt: 'Test',
        selectedModels: [LlmModels.Gemini25Pro],
        synthesisModel: LlmModels.Gemini25Pro,
        status: 'pending',
        llmResults: [],
        favourite: false,
        startedAt: '2024-01-01T00:00:00Z',
      };

      // Mock doc().get() for cursor startAfter calls
      mockDocGet.mockResolvedValue({ exists: true, id: 'research-fav', data: () => favoriteResearch });

      const mockFavoritesGet = vi.fn().mockResolvedValue({
        docs: [
          {
            id: favoriteResearch.id,
            data: (): Research => favoriteResearch,
          },
        ],
      });
      const mockNonFavoritesGet = vi.fn().mockResolvedValue({
        docs: [
          {
            id: normalResearch.id,
            data: (): Research => normalResearch,
          },
        ],
      });

      // Mock favorites query
      const favoritesQuery = {
        limit: vi.fn().mockReturnValue({
          get: mockFavoritesGet,
        }),
      };
      // Mock non-favorites query
      const nonFavoritesQuery = {
        limit: vi.fn().mockReturnValue({
          get: mockNonFavoritesGet,
        }),
      };

      mockWhere
        .mockReturnValueOnce({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue(favoritesQuery),
          }),
        })
        .mockReturnValueOnce({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue(nonFavoritesQuery),
          }),
        });

      const result = await repository.findByUserId('user-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        const { items } = result.value;
        expect(items).toHaveLength(2);
        // Favorites should come first
        expect(items[0]?.id).toBe('research-fav');
        expect(items[0]?.favourite).toBe(true);
        expect(items[1]?.id).toBe('research-2');
        expect(items[1]?.favourite).toBe(false);
        // Cursor indicates non-favorites since we fetched from both
        expect(result.value.nextCursor).toBeUndefined();
      }
    });

    it('returns empty list when no results', async () => {
      const mockGet = vi.fn().mockResolvedValue({ docs: [] });

      mockWhere.mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              get: mockGet,
            }),
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

    it('returns empty list when cursor type is "done" (no more results)', async () => {
      // This covers the "done" cursor type branch at line 75-76
      const result = await repository.findByUserId('user-1', { cursor: 'done:' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.items).toHaveLength(0);
        expect(result.value.nextCursor).toBeUndefined();
      }
    });

    it('handles cursor with missing type gracefully (queries favorites first, then non)', async () => {
      // Covers cursor without ":" separator - defaults to normal query
      const nonFavorites: Research[] = [
        {
          id: 'non-1',
          userId: 'user-1',
          title: 'Non-Favorite',
          prompt: 'Test',
          selectedModels: [LlmModels.Gemini25Pro],
          synthesisModel: LlmModels.Gemini25Pro,
          status: 'pending',
          llmResults: [],
          favourite: false,
          startedAt: '2024-01-01T00:00:00Z',
        },
      ];

      // Favorites query returns empty, non-favorites returns data
      const mockFavoritesGet = vi.fn().mockResolvedValue({ docs: [] });
      const mockNonFavoritesGet = vi.fn().mockResolvedValue({
        docs: nonFavorites.map((r): { id: string; data: () => Research } => ({
          id: r.id,
          data: (): Research => r,
        })),
      });

      let callCount = 0;
      mockWhere.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // Favorites query (but we'll return empty)
          return {
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  get: mockFavoritesGet,
                }),
              }),
            }),
          };
        }
        // Non-favorites query
        return {
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                get: mockNonFavoritesGet,
              }),
            }),
          }),
        };
      });

      // Malformed cursor (no ":") - queries favorites first (empty), then non-favorites
      const result = await repository.findByUserId('user-1', { cursor: 'malformed', limit: 5 });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.items).toHaveLength(1);
        expect(result.value.items[0]?.id).toBe('non-1');
      }
    });

    it('respects limit parameter', async () => {
      const favorites: Research[] = Array.from({ length: 10 }, (_, i) => ({
        id: `fav-${i}`,
        userId: 'user-1',
        title: `Favorite ${i}`,
        prompt: 'Test',
        selectedModels: [LlmModels.Gemini25Pro],
        synthesisModel: LlmModels.Gemini25Pro,
        status: 'pending',
        llmResults: [],
        favourite: true,
        startedAt: '2024-01-01T00:00:00Z',
      }));

      const mockGet = vi.fn().mockResolvedValue({
        docs: favorites.slice(0, 5).map((r): { id: string; data: () => Research } => ({ id: r.id, data: (): Research => r })),
      });

      mockWhere.mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              get: mockGet,
            }),
          }),
        }),
      });

      const result = await repository.findByUserId('user-1', { limit: 5 });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.items).toHaveLength(5);
      }
    });

    it('returns cursor when more favorites available', async () => {
      const favorites: Research[] = Array.from({ length: 6 }, (_, i) => ({
        id: `fav-${i}`,
        userId: 'user-1',
        title: `Favorite ${i}`,
        prompt: 'Test',
        selectedModels: [LlmModels.Gemini25Pro],
        synthesisModel: LlmModels.Gemini25Pro,
        status: 'pending',
        llmResults: [],
        favourite: true,
        startedAt: '2024-01-01T00:00:00Z',
      }));

      const mockGet = vi.fn().mockResolvedValue({
        // Return 6 items (limit + 1) to indicate more available
        docs: favorites.map((r): { id: string; data: () => Research } => ({ id: r.id, data: (): Research => r })),
      });

      mockWhere.mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              get: mockGet,
            }),
          }),
        }),
      });

      const result = await repository.findByUserId('user-1', { limit: 5 });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.items).toHaveLength(5);
        // Cursor should point to the last returned item (fav-4)
        expect(result.value.nextCursor).toBe('fav:fav-4');
      }
    });

    it('shows non-favorites when fewer favorites than limit', async () => {
      const favorite: Research = {
        id: 'fav-1',
        userId: 'user-1',
        title: 'Favorite',
        prompt: 'Test',
        selectedModels: [LlmModels.Gemini25Pro],
        synthesisModel: LlmModels.Gemini25Pro,
        status: 'pending',
        llmResults: [],
        favourite: true,
        startedAt: '2024-01-02T00:00:00Z',
      };
      const nonFavorites: Research[] = Array.from({ length: 10 }, (_, i) => ({
        id: `non-${i}`,
        userId: 'user-1',
        title: `Non-Favorite ${i}`,
        prompt: 'Test',
        selectedModels: [LlmModels.Gemini25Pro],
        synthesisModel: LlmModels.Gemini25Pro,
        status: 'pending',
        llmResults: [],
        favourite: false,
        startedAt: '2024-01-01T00:00:00Z',
      }));

      let callCount = 0;
      mockWhere.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // Favorites query
          return {
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  get: vi.fn().mockResolvedValue({
                    docs: [{ id: favorite.id, data: (): Research => favorite }],
                  }),
                }),
              }),
            }),
          };
        }
        // Non-favorites query
        return {
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({
                  docs: nonFavorites.map((r): { id: string; data: () => Research } => ({
                    id: r.id,
                    data: (): Research => r,
                  })),
                }),
              }),
            }),
          }),
        };
      });

      const result = await repository.findByUserId('user-1', { limit: 5 });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.items).toHaveLength(5);
        // First item should be the favorite
        expect(result.value.items[0]?.id).toBe('fav-1');
        expect(result.value.items[0]?.favourite).toBe(true);
        // Rest should be non-favorites
        expect(result.value.items[1]?.favourite).toBe(false);
        // More non-favorites available, so cursor should be 'non:non-3'
        expect(result.value.nextCursor).toBe('non:non-3');
      }
    });

    it('paginates through favorites using fav: cursor', async () => {
      const favorites: Research[] = Array.from({ length: 11 }, (_, i) => ({
        id: `fav-${i}`,
        userId: 'user-1',
        title: `Favorite ${i}`,
        prompt: 'Test',
        selectedModels: [LlmModels.Gemini25Pro],
        synthesisModel: LlmModels.Gemini25Pro,
        status: 'pending',
        llmResults: [],
        favourite: true,
        startedAt: '2024-01-01T00:00:00Z',
      }));

      // Mock doc().get() to return the start document for startAfter
      const fourthFavorite = favorites[4];
      if (fourthFavorite === undefined) {
        throw new Error('Test setup error: favorites[4] should be defined');
      }
      const startDoc = { id: 'fav-4', exists: true, data: (): Research => fourthFavorite };
      mockDocGet.mockResolvedValue(startDoc);

      // Return 6 items starting after fav-4 (fav-5 to fav-10)
      const mockStartAfter = vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({
          docs: favorites.slice(5, 11).map((r): { id: string; data: () => Research } => ({
            id: r.id,
            data: (): Research => r,
          })),
        }),
      });

      mockWhere.mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              startAfter: mockStartAfter,
            }),
          }),
        }),
      });

      const result = await repository.findByUserId('user-1', { limit: 5, cursor: 'fav:fav-4' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.items).toHaveLength(5);
        expect(mockDoc).toHaveBeenCalledWith('fav-4');
        expect(mockStartAfter).toHaveBeenCalledWith(startDoc);
        // We got 6 items but only returned 5, so there's more
        expect(result.value.nextCursor).toBe('fav:fav-9');
      }
    });

    it('paginates through non-favorites using non: cursor', async () => {
      const nonFavorites: Research[] = Array.from({ length: 10 }, (_, i) => ({
        id: `non-${i}`,
        userId: 'user-1',
        title: `Non-Favorite ${i}`,
        prompt: 'Test',
        selectedModels: [LlmModels.Gemini25Pro],
        synthesisModel: LlmModels.Gemini25Pro,
        status: 'pending',
        llmResults: [],
        favourite: false,
        startedAt: '2024-01-01T00:00:00Z',
      }));

      const fourthNonFavorite = nonFavorites[4];
      if (fourthNonFavorite === undefined) {
        throw new Error('Test setup error: nonFavorites[4] should be defined');
      }
      const startDoc = { id: 'non-4', exists: true, data: (): Research => fourthNonFavorite };
      mockDocGet.mockResolvedValue(startDoc);

      // Mock the query chain with startAfter
      const mockStartAfter = vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({
          docs: nonFavorites.slice(5).map((r): { id: string; data: () => Research } => ({
            id: r.id,
            data: (): Research => r,
          })),
        }),
      });

      mockWhere.mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              startAfter: mockStartAfter,
            }),
          }),
        }),
      });

      const result = await repository.findByUserId('user-1', { limit: 5, cursor: 'non:non-4' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.items).toHaveLength(5);
        expect(result.value.nextCursor).toBeUndefined();
      }
    });

    it('returns error on Firestore failure', async () => {
      const mockGet = vi.fn().mockRejectedValue(new Error('Query failed'));

      mockWhere.mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              get: mockGet,
            }),
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
          {
            provider: LlmProviders.Google,
            model: LlmModels.Gemini20Flash,
            status: 'failed',
            error: 'Rate limit',
          },
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
          {
            provider: LlmProviders.Google,
            model: LlmModels.Gemini20Flash,
            status: 'failed',
            error: 'Rate limit',
          },
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
        llmResults: [
          { provider: LlmProviders.Google, model: LlmModels.Gemini20Flash, status: 'processing' },
        ],
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
        llmResults: [
          { provider: LlmProviders.Google, model: LlmModels.Gemini20Flash, status: 'processing' },
        ],
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
