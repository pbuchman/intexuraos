import { useCallback, useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import {
  createFishingKnowledgeFolder,
  createFishingKnowledgePage,
  deleteFishingKnowledgeFolder,
  deleteFishingKnowledgePage,
  getFishingKnowledgePage,
  listFishingKnowledgeFolders,
  listFishingKnowledgePages,
  reindexFishingKnowledgePage,
  updateFishingKnowledgeFolder,
  updateFishingKnowledgePage,
} from '@/services/fishingAssistantApi';
import type { FishingKnowledgeFolder, FishingKnowledgePage } from '@/types/fishingAssistant';

export interface UseFishingKnowledgeResult {
  readonly folders: readonly FishingKnowledgeFolder[];
  readonly pages: readonly FishingKnowledgePage[];
  readonly loading: boolean;
  readonly mutating: boolean;
  readonly error: string | null;
  readonly refresh: () => Promise<void>;
  readonly createFolder: (name: string, parentId?: string | null, sortOrder?: number) => Promise<FishingKnowledgeFolder>;
  readonly renameFolder: (
    folderId: string,
    name: string,
    parentId?: string | null,
    sortOrder?: number
  ) => Promise<FishingKnowledgeFolder>;
  readonly deleteFolder: (folderId: string) => Promise<void>;
  readonly createPage: (folderId: string, rawText: string) => Promise<FishingKnowledgePage>;
  readonly loadPage: (pageId: string) => Promise<FishingKnowledgePage>;
  readonly updatePage: (pageId: string, rawText: string) => Promise<FishingKnowledgePage>;
  readonly deletePage: (pageId: string) => Promise<void>;
  readonly reindexPage: (pageId: string) => Promise<FishingKnowledgePage>;
}

export function useFishingKnowledge(
  selectedFolderId?: string
): UseFishingKnowledgeResult {
  const { getAccessToken } = useAuth();
  const [folders, setFolders] = useState<FishingKnowledgeFolder[]>([]);
  const [pages, setPages] = useState<FishingKnowledgePage[]>([]);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return (): void => {
      mountedRef.current = false;
    };
  }, []);

  const loadLists = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const [folderItems, pageItems] = await Promise.all([
        listFishingKnowledgeFolders(token),
        listFishingKnowledgePages(token, selectedFolderId),
      ]);
      if (!mountedRef.current) return;
      setFolders(folderItems);
      setPages(pageItems);
    } catch (err: unknown) {
      if (mountedRef.current) {
        setError(getErrorMessage(err, 'Failed to load Fishing Assistant knowledge base'));
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [getAccessToken, selectedFolderId]);

  useEffect(() => {
    void loadLists();
  }, [loadLists]);

  const withMutation = useCallback(
    async <T,>(operation: (token: string) => Promise<T>, refreshPagesForFolder?: string): Promise<T> => {
      setMutating(true);
      setError(null);
      try {
        const token = await getAccessToken();
        const result = await operation(token);
        const [folderItems, pageItems] = await Promise.all([
          listFishingKnowledgeFolders(token),
          listFishingKnowledgePages(token, refreshPagesForFolder ?? selectedFolderId),
        ]);
        if (mountedRef.current) {
          setFolders(folderItems);
          setPages(pageItems);
        }
        return result;
      } catch (err: unknown) {
        const message = getErrorMessage(err, 'Failed to update Fishing Assistant knowledge base');
        if (mountedRef.current) {
          setError(message);
        }
        throw err;
      } finally {
        if (mountedRef.current) {
          setMutating(false);
        }
      }
    },
    [getAccessToken, selectedFolderId]
  );

  const createFolder = useCallback(
    async (name: string, parentId?: string | null, sortOrder = 0): Promise<FishingKnowledgeFolder> => {
      return await withMutation((token) =>
        createFishingKnowledgeFolder(token, {
          name,
          parentId: parentId ?? null,
          sortOrder,
        })
      );
    },
    [withMutation]
  );

  const renameFolder = useCallback(
    async (
      folderId: string,
      name: string,
      parentId?: string | null,
      sortOrder = 0
    ): Promise<FishingKnowledgeFolder> => {
      return await withMutation((token) =>
        updateFishingKnowledgeFolder(token, folderId, {
          name,
          parentId: parentId ?? null,
          sortOrder,
        })
      );
    },
    [withMutation]
  );

  const removeFolder = useCallback(
    async (folderId: string): Promise<void> => {
      await withMutation((token) => deleteFishingKnowledgeFolder(token, folderId));
    },
    [withMutation]
  );

  const createPage = useCallback(
    async (folderId: string, rawText: string): Promise<FishingKnowledgePage> => {
      return await withMutation(
        (token) => createFishingKnowledgePage(token, { folderId, rawText }),
        folderId
      );
    },
    [withMutation]
  );

  const loadPage = useCallback(
    async (pageId: string): Promise<FishingKnowledgePage> => {
      const token = await getAccessToken();
      return await getFishingKnowledgePage(token, pageId);
    },
    [getAccessToken]
  );

  const updatePage = useCallback(
    async (pageId: string, rawText: string): Promise<FishingKnowledgePage> => {
      return await withMutation((token) => updateFishingKnowledgePage(token, pageId, { rawText }));
    },
    [withMutation]
  );

  const removePage = useCallback(
    async (pageId: string): Promise<void> => {
      await withMutation((token) => deleteFishingKnowledgePage(token, pageId));
    },
    [withMutation]
  );

  const reindexPage = useCallback(
    async (pageId: string): Promise<FishingKnowledgePage> => {
      return await withMutation((token) => reindexFishingKnowledgePage(token, pageId));
    },
    [withMutation]
  );

  return {
    folders,
    pages,
    loading,
    mutating,
    error,
    refresh: loadLists,
    createFolder,
    renameFolder,
    deleteFolder: removeFolder,
    createPage,
    loadPage,
    updatePage,
    deletePage: removePage,
    reindexPage,
  };
}
