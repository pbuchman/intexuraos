import { describe, expect, it, vi } from 'vitest';
import { createFakeFirestore, type Firestore } from '@intexuraos/infra-firestore';
import { err, ok, type Logger } from '@intexuraos/common-core';
import { createFirestoreChunkRepository } from '../infra/firestore/chunkRepository.js';
import { createFirestoreFolderRepository } from '../infra/firestore/folderRepository.js';
import { createFirestorePageRepository } from '../infra/firestore/pageRepository.js';
import {
  createKnowledgePage,
  reindexKnowledgePage,
  updateKnowledgePage,
  type KnowledgePageIndexingDeps,
} from '../domain/usecases/indexKnowledgePage.js';
import type { KnowledgeEmbeddingClient } from '../domain/ports/embeddingClient.js';
import type {
  KnowledgeChunkRepository,
  KnowledgePageRepository,
} from '../domain/ports/knowledgeRepositories.js';

const logger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function createEmbeddingClient(fail = false): KnowledgeEmbeddingClient {
  return {
    async embedTexts(input): ReturnType<KnowledgeEmbeddingClient['embedTexts']> {
      if (fail) {
        return err({ code: 'EMBEDDING_FAILED', message: 'Embedding service failed' });
      }
      return ok(input.texts.map(() => [0.1, 0.2, 0.3]));
    },
  };
}

function createShortEmbeddingClient(): KnowledgeEmbeddingClient {
  return {
    async embedTexts(): ReturnType<KnowledgeEmbeddingClient['embedTexts']> {
      return ok([]);
    },
  };
}

function createLongEmbeddingClient(): KnowledgeEmbeddingClient {
  return {
    async embedTexts(input): ReturnType<KnowledgeEmbeddingClient['embedTexts']> {
      return ok([...input.texts.map(() => [0.1, 0.2, 0.3]), [0.9, 0.8, 0.7]]);
    },
  };
}

function createUndefinedEmbeddingClient(): KnowledgeEmbeddingClient {
  return {
    async embedTexts(input): ReturnType<KnowledgeEmbeddingClient['embedTexts']> {
      return ok(input.texts.map(() => undefined as unknown as number[]));
    },
  };
}

interface IndexingTestContext {
  folders: ReturnType<typeof createFirestoreFolderRepository>;
  pages: ReturnType<typeof createFirestorePageRepository>;
  chunks: ReturnType<typeof createFirestoreChunkRepository>;
  deps: KnowledgePageIndexingDeps;
}

function createContext(failEmbedding = false): IndexingTestContext {
  const firestore = createFakeFirestore() as unknown as Firestore;
  const folders = createFirestoreFolderRepository({ firestore, logger });
  const pages = createFirestorePageRepository({ firestore, logger });
  const chunks = createFirestoreChunkRepository({ firestore, logger });
  return {
    folders,
    pages,
    chunks,
    deps: {
      pageRepository: pages,
      chunkRepository: chunks,
      embeddingClient: createEmbeddingClient(failEmbedding),
      generateId: vi.fn()
        .mockReturnValueOnce('page-1')
        .mockReturnValueOnce('chunk-1')
        .mockReturnValueOnce('chunk-2')
        .mockReturnValue('chunk-extra'),
    },
  };
}

const recipeText = [
  'Zanęta delikatna',
  '',
  'Ta zanęta spisuje się gdy woda ma temperaturę w granicach 22 stopni.',
  '',
  'Baza strukturalna:',
  '-300 g otrębów pszennych',
  '-150 g kukurydzy mielonej',
  '',
  'Zioła:',
  '-1 łyżeczka kolendry mielonej',
].join('\n');

describe('Fishing Assistant knowledge page indexing', () => {
  it('creates a ready page with normalized text and embedded chunks', async () => {
    const ctx = createContext();
    await ctx.folders.create({ id: 'folder-1', userId: 'user-1', name: 'Kurs', parentId: null, sortOrder: 0 });

    const result = await createKnowledgePage(ctx.deps, {
      userId: 'user-1',
      folderId: 'folder-1',
      rawText: recipeText,
    });

    expect(result.ok).toBe(true);
    const page = await ctx.pages.getByIdForUser({ userId: 'user-1', pageId: 'page-1' });
    const chunks = await ctx.chunks.findByPageId({ userId: 'user-1', pageId: 'page-1' });
    expect(page.ok).toBe(true);
    expect(chunks.ok).toBe(true);
    if (!result.ok || !page.ok || !chunks.ok) return;
    expect(result.value.indexingStatus).toBe('ready');
    expect(page.value?.title).toBe('Zanęta delikatna');
    expect(page.value?.normalizedText).toContain('- 300 g otrębów pszennych');
    expect(page.value?.chunkCount).toBe(chunks.value.length);
    expect(chunks.value[0]?.searchableText).toContain('Page: Zanęta delikatna');
  });

  it('stores a visible failed page with no chunks when embedding fails', async () => {
    const ctx = createContext(true);
    await ctx.folders.create({ id: 'folder-1', userId: 'user-1', name: 'Kurs', parentId: null, sortOrder: 0 });

    const result = await createKnowledgePage(ctx.deps, {
      userId: 'user-1',
      folderId: 'folder-1',
      rawText: recipeText,
    });

    expect(result.ok).toBe(true);
    const page = await ctx.pages.getByIdForUser({ userId: 'user-1', pageId: 'page-1' });
    const chunks = await ctx.chunks.findByPageId({ userId: 'user-1', pageId: 'page-1' });
    expect(page.ok).toBe(true);
    expect(chunks.ok).toBe(true);
    if (!result.ok || !page.ok || !chunks.ok) return;
    expect(result.value.indexingStatus).toBe('failed');
    expect(page.value?.indexingError).toBe('Embedding service failed');
    expect(page.value?.chunkCount).toBe(0);
    expect(chunks.value).toEqual([]);
  });

  it('updates edited content and removes stale chunks when re-embedding fails', async () => {
    const ctx = createContext();
    await ctx.folders.create({ id: 'folder-1', userId: 'user-1', name: 'Kurs', parentId: null, sortOrder: 0 });
    await createKnowledgePage(ctx.deps, {
      userId: 'user-1',
      folderId: 'folder-1',
      rawText: recipeText,
    });

    const failedDeps = {
      ...ctx.deps,
      embeddingClient: createEmbeddingClient(true),
    };
    const result = await updateKnowledgePage(failedDeps, {
      userId: 'user-1',
      pageId: 'page-1',
      rawText: 'Nowy przepis\n\n-500 g pieczywa',
    });

    expect(result.ok).toBe(true);
    const page = await ctx.pages.getByIdForUser({ userId: 'user-1', pageId: 'page-1' });
    const chunks = await ctx.chunks.findByPageId({ userId: 'user-1', pageId: 'page-1' });
    expect(page.ok).toBe(true);
    expect(chunks.ok).toBe(true);
    if (!result.ok || !page.ok || !chunks.ok) return;
    expect(page.value?.title).toBe('Nowy przepis');
    expect(page.value?.indexingStatus).toBe('failed');
    expect(page.value?.chunkCount).toBe(0);
    expect(chunks.value).toEqual([]);
  });

  it('reindexes a failed page from stored raw text', async () => {
    const ctx = createContext(true);
    await ctx.folders.create({ id: 'folder-1', userId: 'user-1', name: 'Kurs', parentId: null, sortOrder: 0 });
    await createKnowledgePage(ctx.deps, {
      userId: 'user-1',
      folderId: 'folder-1',
      rawText: recipeText,
    });

    const successDeps = {
      ...ctx.deps,
      embeddingClient: createEmbeddingClient(false),
      generateId: vi.fn().mockReturnValueOnce('chunk-reindexed').mockReturnValue('chunk-extra'),
    };
    const result = await reindexKnowledgePage(successDeps, {
      userId: 'user-1',
      pageId: 'page-1',
    });

    expect(result.ok).toBe(true);
    const chunks = await ctx.chunks.findByPageId({ userId: 'user-1', pageId: 'page-1' });
    expect(chunks.ok).toBe(true);
    if (!result.ok || !chunks.ok) return;
    expect(result.value.indexingStatus).toBe('ready');
    expect(chunks.value.length).toBeGreaterThan(0);
  });

  it('rejects pages that would create more than 120 chunks', async () => {
    const ctx = createContext();
    await ctx.folders.create({ id: 'folder-1', userId: 'user-1', name: 'Kurs', parentId: null, sortOrder: 0 });
    const oversizedText = `Duży dokument\n\n${Array.from({ length: 121 }, (_, index) => [
      `Sekcja ${String(index)}:`,
      '-100 g składnika',
    ].join('\n')).join('\n\n')}`;

    const result = await createKnowledgePage(ctx.deps, {
      userId: 'user-1',
      folderId: 'folder-1',
      rawText: oversizedText,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PAGE_TOO_LARGE');
  });

  it('fails when embedding result count does not match generated chunks', async () => {
    const ctx = createContext();
    await ctx.folders.create({ id: 'folder-1', userId: 'user-1', name: 'Kurs', parentId: null, sortOrder: 0 });

    const result = await createKnowledgePage(
      {
        ...ctx.deps,
        embeddingClient: createShortEmbeddingClient(),
      },
      {
        userId: 'user-1',
        folderId: 'folder-1',
        rawText: recipeText,
      }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EMBEDDING_FAILED');
  });

  it('fails when embedding returns extra vectors for generated chunks', async () => {
    const ctx = createContext();
    await ctx.folders.create({ id: 'folder-1', userId: 'user-1', name: 'Kurs', parentId: null, sortOrder: 0 });

    const result = await createKnowledgePage(
      {
        ...ctx.deps,
        embeddingClient: createLongEmbeddingClient(),
      },
      {
        userId: 'user-1',
        folderId: 'folder-1',
        rawText: recipeText,
      }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EMBEDDING_FAILED');
  });

  it('fails when embedding returns undefined vectors for generated chunks', async () => {
    const ctx = createContext();
    await ctx.folders.create({ id: 'folder-1', userId: 'user-1', name: 'Kurs', parentId: null, sortOrder: 0 });

    const result = await createKnowledgePage(
      {
        ...ctx.deps,
        embeddingClient: createUndefinedEmbeddingClient(),
      },
      {
        userId: 'user-1',
        folderId: 'folder-1',
        rawText: recipeText,
      }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EMBEDDING_FAILED');
  });

  it('returns repository errors from page create and chunk writes', async () => {
    const pageFailure = createContext();
    const failingPages: KnowledgePageRepository = {
      create: vi.fn(async () => err({ code: 'FIRESTORE_ERROR' as const, message: 'page create failed' })),
      getByIdForUser: pageFailure.pages.getByIdForUser.bind(pageFailure.pages),
      listByUserId: pageFailure.pages.listByUserId.bind(pageFailure.pages),
      updateForUser: pageFailure.pages.updateForUser.bind(pageFailure.pages),
      deleteForUser: pageFailure.pages.deleteForUser.bind(pageFailure.pages),
    };
    const pageCreateResult = await createKnowledgePage(
      {
        ...pageFailure.deps,
        pageRepository: failingPages,
      },
      {
        userId: 'user-1',
        folderId: 'folder-1',
        rawText: recipeText,
      }
    );

    const chunkFailure = createContext();
    await chunkFailure.folders.create({
      id: 'folder-1',
      userId: 'user-1',
      name: 'Kurs',
      parentId: null,
      sortOrder: 0,
    });
    const failingChunks: KnowledgeChunkRepository = {
      replaceForPage: vi.fn(async () => err({ code: 'FIRESTORE_ERROR' as const, message: 'chunk write failed' })),
      findByPageId: chunkFailure.chunks.findByPageId.bind(chunkFailure.chunks),
      deleteByPageId: chunkFailure.chunks.deleteByPageId.bind(chunkFailure.chunks),
      findNearestByUserId: chunkFailure.chunks.findNearestByUserId.bind(chunkFailure.chunks),
    };
    const chunkResult = await createKnowledgePage(
      {
        ...chunkFailure.deps,
        chunkRepository: failingChunks,
      },
      {
        userId: 'user-1',
        folderId: 'folder-1',
        rawText: recipeText,
      }
    );

    expect(pageCreateResult.ok).toBe(false);
    expect(chunkResult.ok).toBe(false);
    if (pageCreateResult.ok || chunkResult.ok) return;
    expect(pageCreateResult.error.message).toBe('page create failed');
    expect(chunkResult.error.message).toBe('chunk write failed');
  });

  it('returns not found when updating or reindexing a missing page', async () => {
    const ctx = createContext();

    const updated = await updateKnowledgePage(ctx.deps, {
      userId: 'user-1',
      pageId: 'missing-page',
      rawText: recipeText,
    });
    const reindexed = await reindexKnowledgePage(ctx.deps, {
      userId: 'user-1',
      pageId: 'missing-page',
    });

    expect(updated.ok).toBe(false);
    expect(reindexed.ok).toBe(false);
    if (updated.ok || reindexed.ok) return;
    expect(updated.error.code).toBe('NOT_FOUND');
    expect(reindexed.error.code).toBe('NOT_FOUND');
  });

  it('propagates page lookup repository errors during update and reindex', async () => {
    const ctx = createContext();
    const failingPages: KnowledgePageRepository = {
      create: ctx.pages.create.bind(ctx.pages),
      getByIdForUser: vi.fn(async () => err({ code: 'FIRESTORE_ERROR' as const, message: 'lookup failed' })),
      listByUserId: ctx.pages.listByUserId.bind(ctx.pages),
      updateForUser: ctx.pages.updateForUser.bind(ctx.pages),
      deleteForUser: ctx.pages.deleteForUser.bind(ctx.pages),
    };
    const deps = {
      ...ctx.deps,
      pageRepository: failingPages,
    };

    const updated = await updateKnowledgePage(deps, {
      userId: 'user-1',
      pageId: 'page-1',
      rawText: recipeText,
    });
    const reindexed = await reindexKnowledgePage(deps, {
      userId: 'user-1',
      pageId: 'page-1',
    });

    expect(updated.ok).toBe(false);
    expect(reindexed.ok).toBe(false);
    if (updated.ok || reindexed.ok) return;
    expect(updated.error.message).toBe('lookup failed');
    expect(reindexed.error.message).toBe('lookup failed');
  });

  it('rejects edited pages that would create more than 120 chunks', async () => {
    const ctx = createContext();
    await ctx.folders.create({ id: 'folder-1', userId: 'user-1', name: 'Kurs', parentId: null, sortOrder: 0 });
    await createKnowledgePage(ctx.deps, {
      userId: 'user-1',
      folderId: 'folder-1',
      rawText: recipeText,
    });
    const oversizedText = `Duży dokument\n\n${Array.from({ length: 121 }, (_, index) => [
      `Sekcja ${String(index)}:`,
      '-100 g składnika',
    ].join('\n')).join('\n\n')}`;

    const result = await updateKnowledgePage(ctx.deps, {
      userId: 'user-1',
      pageId: 'page-1',
      rawText: oversizedText,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PAGE_TOO_LARGE');
  });

  it('fails update when embedding result count does not match edited chunks', async () => {
    const ctx = createContext();
    await ctx.folders.create({ id: 'folder-1', userId: 'user-1', name: 'Kurs', parentId: null, sortOrder: 0 });
    await createKnowledgePage(ctx.deps, {
      userId: 'user-1',
      folderId: 'folder-1',
      rawText: recipeText,
    });

    const result = await updateKnowledgePage(
      {
        ...ctx.deps,
        embeddingClient: createShortEmbeddingClient(),
      },
      {
        userId: 'user-1',
        pageId: 'page-1',
        rawText: 'Nowy przepis\n\n-100 g składnika',
      }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EMBEDDING_FAILED');
  });

  it('propagates update failures while marking edited pages as failed', async () => {
    const ctx = createContext();
    await ctx.folders.create({ id: 'folder-1', userId: 'user-1', name: 'Kurs', parentId: null, sortOrder: 0 });
    await createKnowledgePage(ctx.deps, {
      userId: 'user-1',
      folderId: 'folder-1',
      rawText: recipeText,
    });
    const failingPages: KnowledgePageRepository = {
      create: ctx.pages.create.bind(ctx.pages),
      getByIdForUser: ctx.pages.getByIdForUser.bind(ctx.pages),
      listByUserId: ctx.pages.listByUserId.bind(ctx.pages),
      updateForUser: vi.fn(async () => err({ code: 'FIRESTORE_ERROR' as const, message: 'page update failed' })),
      deleteForUser: ctx.pages.deleteForUser.bind(ctx.pages),
    };
    const result = await updateKnowledgePage(
      {
        ...ctx.deps,
        pageRepository: failingPages,
        embeddingClient: createEmbeddingClient(true),
      },
      {
        userId: 'user-1',
        pageId: 'page-1',
        rawText: 'Nowy przepis\n\n-100 g składnika',
      }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe('page update failed');
  });

  it('propagates stale chunk deletion failures after embedding fails', async () => {
    const ctx = createContext();
    await ctx.folders.create({ id: 'folder-1', userId: 'user-1', name: 'Kurs', parentId: null, sortOrder: 0 });
    await createKnowledgePage(ctx.deps, {
      userId: 'user-1',
      folderId: 'folder-1',
      rawText: recipeText,
    });
    const failingChunks: KnowledgeChunkRepository = {
      replaceForPage: vi.fn(async () => err({ code: 'FIRESTORE_ERROR' as const, message: 'chunk delete failed' })),
      findByPageId: ctx.chunks.findByPageId.bind(ctx.chunks),
      deleteByPageId: ctx.chunks.deleteByPageId.bind(ctx.chunks),
      findNearestByUserId: ctx.chunks.findNearestByUserId.bind(ctx.chunks),
    };

    const result = await updateKnowledgePage(
      {
        ...ctx.deps,
        chunkRepository: failingChunks,
        embeddingClient: createEmbeddingClient(true),
      },
      {
        userId: 'user-1',
        pageId: 'page-1',
        rawText: 'Nowy przepis\n\n-100 g składnika',
      }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe('chunk delete failed');
  });

  it('propagates successful reindex page and chunk write failures', async () => {
    const pageFailure = createContext();
    await pageFailure.folders.create({ id: 'folder-1', userId: 'user-1', name: 'Kurs', parentId: null, sortOrder: 0 });
    await createKnowledgePage(pageFailure.deps, {
      userId: 'user-1',
      folderId: 'folder-1',
      rawText: recipeText,
    });
    const failingPages: KnowledgePageRepository = {
      create: pageFailure.pages.create.bind(pageFailure.pages),
      getByIdForUser: pageFailure.pages.getByIdForUser.bind(pageFailure.pages),
      listByUserId: pageFailure.pages.listByUserId.bind(pageFailure.pages),
      updateForUser: vi.fn(async () => err({ code: 'FIRESTORE_ERROR' as const, message: 'ready update failed' })),
      deleteForUser: pageFailure.pages.deleteForUser.bind(pageFailure.pages),
    };
    const pageResult = await reindexKnowledgePage(
      {
        ...pageFailure.deps,
        pageRepository: failingPages,
      },
      { userId: 'user-1', pageId: 'page-1' }
    );

    const chunkFailure = createContext();
    await chunkFailure.folders.create({ id: 'folder-1', userId: 'user-1', name: 'Kurs', parentId: null, sortOrder: 0 });
    await createKnowledgePage(chunkFailure.deps, {
      userId: 'user-1',
      folderId: 'folder-1',
      rawText: recipeText,
    });
    const failingChunks: KnowledgeChunkRepository = {
      replaceForPage: vi.fn(async () => err({ code: 'FIRESTORE_ERROR' as const, message: 'ready chunks failed' })),
      findByPageId: chunkFailure.chunks.findByPageId.bind(chunkFailure.chunks),
      deleteByPageId: chunkFailure.chunks.deleteByPageId.bind(chunkFailure.chunks),
      findNearestByUserId: chunkFailure.chunks.findNearestByUserId.bind(chunkFailure.chunks),
    };
    const chunkResult = await reindexKnowledgePage(
      {
        ...chunkFailure.deps,
        chunkRepository: failingChunks,
      },
      { userId: 'user-1', pageId: 'page-1' }
    );

    expect(pageResult.ok).toBe(false);
    expect(chunkResult.ok).toBe(false);
    if (pageResult.ok || chunkResult.ok) return;
    expect(pageResult.error.message).toBe('ready update failed');
    expect(chunkResult.error.message).toBe('ready chunks failed');
  });
});
