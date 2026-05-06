/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const { mockGetAccessToken, mockApi } = vi.hoisted(() => ({
  mockGetAccessToken: vi.fn(),
  mockApi: {
    listFishingKnowledgeFolders: vi.fn(),
    listFishingKnowledgePages: vi.fn(),
    createFishingKnowledgeFolder: vi.fn(),
    createFishingKnowledgePage: vi.fn(),
  },
}));

vi.mock('@/context', () => ({
  useAuth: (): { getAccessToken: typeof mockGetAccessToken } => ({
    getAccessToken: mockGetAccessToken,
  }),
}));

vi.mock('@/services/fishingAssistantApi', () => mockApi);

vi.mock('@intexuraos/common-core/errors', () => ({
  getErrorMessage: (err: unknown, defaultMsg: string): string =>
    err instanceof Error ? err.message : defaultMsg,
}));

import { useFishingKnowledge } from '../useFishingKnowledge.js';

describe('useFishingKnowledge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue('tok');
  });

  it('loads folders and pages for the selected folder', async () => {
    mockApi.listFishingKnowledgeFolders.mockResolvedValue([
      { id: 'folder-1', name: 'Recipes', userId: 'user-1', parentId: null, sortOrder: 0, pageCount: 1, createdAt: '', updatedAt: '' },
    ]);
    mockApi.listFishingKnowledgePages.mockResolvedValue([
      {
        id: 'page-1',
        userId: 'user-1',
        folderId: 'folder-1',
        title: 'Spring Bait',
        rawText: 'raw',
        normalizedText: 'normalized',
        contentType: 'recipe',
        indexingStatus: 'ready',
        chunkCount: 1,
        createdAt: '',
        updatedAt: '',
      },
    ]);

    const { result } = renderHook(() => useFishingKnowledge('folder-1'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.folders).toHaveLength(1);
    expect(result.current.pages).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it('creates a page and refreshes the page list', async () => {
    mockApi.listFishingKnowledgeFolders.mockResolvedValue([
      { id: 'folder-1', name: 'Recipes', userId: 'user-1', parentId: null, sortOrder: 0, pageCount: 1, createdAt: '', updatedAt: '' },
    ]);
    mockApi.listFishingKnowledgePages
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'page-1',
          userId: 'user-1',
          folderId: 'folder-1',
          title: 'Spring Bait',
          rawText: 'raw',
          normalizedText: 'normalized',
          contentType: 'recipe',
          indexingStatus: 'ready',
          chunkCount: 1,
          createdAt: '',
          updatedAt: '',
        },
      ]);
    mockApi.createFishingKnowledgePage.mockResolvedValue({
      id: 'page-1',
      userId: 'user-1',
      folderId: 'folder-1',
      title: 'Spring Bait',
      rawText: 'raw',
      normalizedText: 'normalized',
      contentType: 'recipe',
      indexingStatus: 'ready',
      chunkCount: 1,
      createdAt: '',
      updatedAt: '',
    });

    const { result } = renderHook(() => useFishingKnowledge('folder-1'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.createPage('folder-1', 'raw');
    });

    expect(mockApi.createFishingKnowledgePage).toHaveBeenCalledWith('tok', {
      folderId: 'folder-1',
      rawText: 'raw',
    });
    expect(result.current.pages).toHaveLength(1);
  });

  it('creates a folder and refreshes the folder list', async () => {
    mockApi.listFishingKnowledgeFolders
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'folder-1', name: 'Recipes', userId: 'user-1', parentId: null, sortOrder: 0, pageCount: 0, createdAt: '', updatedAt: '' },
      ]);
    mockApi.listFishingKnowledgePages.mockResolvedValue([]);
    mockApi.createFishingKnowledgeFolder.mockResolvedValue({
      id: 'folder-1',
      name: 'Recipes',
      userId: 'user-1',
      parentId: null,
      sortOrder: 0,
      pageCount: 0,
      createdAt: '',
      updatedAt: '',
    });

    const { result } = renderHook(() => useFishingKnowledge());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.createFolder('Recipes');
    });

    expect(mockApi.createFishingKnowledgeFolder).toHaveBeenCalledWith('tok', {
      name: 'Recipes',
      parentId: null,
      sortOrder: 0,
    });
    expect(result.current.folders).toHaveLength(1);
  });
});
