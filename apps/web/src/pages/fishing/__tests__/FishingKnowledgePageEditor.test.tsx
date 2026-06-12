/**
 * @vitest-environment jsdom
 */

import { act, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseFishingKnowledgeResult } from '@/hooks/useFishingKnowledge';
import type {
  FishingKnowledgeFolder,
  FishingKnowledgePage,
} from '@/types/fishingAssistant';
import { FishingKnowledgePageEditor } from '../FishingKnowledgePageEditor.js';

const { mockLoadPage, mockUseFishingKnowledge } = vi.hoisted(() => ({
  mockLoadPage: vi.fn(),
  mockUseFishingKnowledge: vi.fn(),
}));

vi.mock('@/hooks', () => ({
  useFishingKnowledge: mockUseFishingKnowledge,
}));

vi.mock('@/components', () => ({
  Layout: ({ children }: { children: React.ReactNode }): React.JSX.Element => <div>{children}</div>,
}));

vi.mock('@/components/fishing', () => ({
  FishingPageEditor: ({ page }: { page: FishingKnowledgePage }): React.JSX.Element => (
    <div data-testid="fishing-page-editor">{page.title}</div>
  ),
}));

vi.mock('@intexuraos/common-core/errors', () => ({
  getErrorMessage: (err: unknown, defaultMsg: string): string =>
    err instanceof Error ? err.message : defaultMsg,
}));

const folder: FishingKnowledgeFolder = {
  id: 'folder-1',
  name: 'Recipes',
  userId: 'user-1',
  parentId: null,
  sortOrder: 0,
  pageCount: 1,
  createdAt: '2026-05-08T10:00:00.000Z',
  updatedAt: '2026-05-08T10:00:00.000Z',
};

const page: FishingKnowledgePage = {
  id: 'page-1',
  userId: 'user-1',
  folderId: 'folder-1',
  title: 'Spring Bait',
  rawText: 'raw',
  normalizedText: 'normalized',
  contentType: 'recipe',
  indexingStatus: 'ready',
  chunkCount: 1,
  createdAt: '2026-05-08T10:00:00.000Z',
  updatedAt: '2026-05-08T10:00:00.000Z',
};

function createDeferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve: (value: T): void => {
      if (resolvePromise === undefined) {
        throw new Error('Deferred promise resolver was not initialized');
      }
      resolvePromise(value);
    },
  };
}

function createKnowledgeResult(): UseFishingKnowledgeResult {
  return {
    folders: [folder],
    pages: [],
    loading: false,
    mutating: false,
    error: null,
    refresh: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    createFolder: vi.fn<UseFishingKnowledgeResult['createFolder']>(),
    renameFolder: vi.fn<UseFishingKnowledgeResult['renameFolder']>(),
    deleteFolder: vi.fn<UseFishingKnowledgeResult['deleteFolder']>(),
    createPage: vi.fn<UseFishingKnowledgeResult['createPage']>(),
    loadPage: mockLoadPage,
    updatePage: vi.fn<UseFishingKnowledgeResult['updatePage']>(),
    deletePage: vi.fn<UseFishingKnowledgeResult['deletePage']>(),
    reindexPage: vi.fn<UseFishingKnowledgeResult['reindexPage']>(),
  };
}

describe('FishingKnowledgePageEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseFishingKnowledge.mockImplementation(createKnowledgeResult);
  });

  it('loads the routed knowledge page once after page state settles', async () => {
    const firstLoad = createDeferred<FishingKnowledgePage>();
    const pendingPageLoad = new Promise<FishingKnowledgePage>((resolve) => {
      void resolve;
    });
    mockLoadPage
      .mockImplementationOnce((): Promise<FishingKnowledgePage> => firstLoad.promise)
      .mockImplementation((): Promise<FishingKnowledgePage> => pendingPageLoad);

    render(
      <MemoryRouter initialEntries={['/fishing-assistant/knowledge/pages/page-1']}>
        <Routes>
          <Route
            path="/fishing-assistant/knowledge/pages/:pageId"
            element={<FishingKnowledgePageEditor />}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(mockLoadPage).toHaveBeenCalledWith('page-1');
    expect(mockLoadPage).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstLoad.resolve(page);
      await firstLoad.promise;
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(mockLoadPage).toHaveBeenCalledTimes(1);
  });
});
