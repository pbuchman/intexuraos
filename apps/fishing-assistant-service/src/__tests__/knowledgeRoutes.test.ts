import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { err, ok, type Logger } from '@intexuraos/common-core';
import type { AuthUser } from '@intexuraos/common-http';
import { createFakeFirestore, type Firestore } from '@intexuraos/infra-firestore';
import OpenAI from 'openai';
import { buildServer } from '../server.js';
import { getServices, resetServices, setServices, type ServiceContainer } from '../services.js';
import { createFirestoreChunkRepository } from '../infra/firestore/chunkRepository.js';
import { createFirestoreFolderRepository } from '../infra/firestore/folderRepository.js';
import { createFirestorePageRepository } from '../infra/firestore/pageRepository.js';
import type { KnowledgeEmbeddingClient } from '../domain/ports/embeddingClient.js';
import { sendKnowledgeError } from '../routes/routeErrors.js';
import type {
  KnowledgeFolderRepository,
  KnowledgePageRepository,
} from '../domain/ports/knowledgeRepositories.js';

const authState = vi.hoisted((): { user: AuthUser | null; logIncomingRequest: ReturnType<typeof vi.fn> } => ({
  user: { userId: 'user-1', claims: { email: 'user@example.com' } },
  logIncomingRequest: vi.fn(),
}));

vi.mock('@intexuraos/common-http', async (importOriginal) => {
  const original = await importOriginal<typeof import('@intexuraos/common-http')>();
  return {
    ...original,
    requireAuth: vi.fn(async (_request: unknown, reply: { fail: (code: string, message: string) => void }) => {
      if (authState.user === null) {
        reply.fail('UNAUTHORIZED', 'Missing auth');
        return null;
      }
      return authState.user;
    }),
    logIncomingRequest: authState.logIncomingRequest,
  };
});

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
        return err({ code: 'EMBEDDING_FAILED', message: 'Embedding failed' });
      }
      return ok(input.texts.map(() => [0.1, 0.2, 0.3]));
    },
  };
}

interface RouteTestContext {
  app: FastifyInstance;
  folders: ReturnType<typeof createFirestoreFolderRepository>;
  pages: ReturnType<typeof createFirestorePageRepository>;
  chunks: ReturnType<typeof createFirestoreChunkRepository>;
  setEmbeddingFailure(fail: boolean): void;
}

function createServices(): Omit<RouteTestContext, 'app'> {
  const firestore = createFakeFirestore() as unknown as Firestore;
  const folders = createFirestoreFolderRepository({ firestore, logger });
  const pages = createFirestorePageRepository({ firestore, logger });
  const chunks = createFirestoreChunkRepository({ firestore, logger });
  let embeddingClient = createEmbeddingClient(false);

  setServices({
    generateId: vi.fn()
      .mockReturnValueOnce('folder-1')
      .mockReturnValueOnce('page-1')
      .mockReturnValueOnce('chunk-1')
      .mockReturnValueOnce('folder-2')
      .mockReturnValueOnce('page-2')
      .mockReturnValueOnce('chunk-2')
      .mockReturnValue('id-extra'),
    logger,
    repositories: {
      firestore,
      folderRepository: folders,
      pageRepository: pages,
      chunkRepository: chunks,
    },
    chatRepository: {} as ServiceContainer['chatRepository'],
    embeddingClient: {
      embedTexts(input) {
        return embeddingClient.embedTexts(input);
      },
    },
    openAiClient: {} as OpenAI,
    userServiceClient: {} as ServiceContainer['userServiceClient'],
    mobileNotificationsClient: {} as ServiceContainer['mobileNotificationsClient'],
    usageSink: {} as ServiceContainer['usageSink'],
    chatAdapter: {} as ServiceContainer['chatAdapter'],
  });

  return {
    folders,
    pages,
    chunks,
    setEmbeddingFailure(fail: boolean): void {
      embeddingClient = createEmbeddingClient(fail);
    },
  };
}

function replaceFolderRepository(overrides: Partial<KnowledgeFolderRepository>): void {
  const services = getServices();
  const repository = services.repositories.folderRepository;
  setServices({
    ...services,
    repositories: {
      ...services.repositories,
      folderRepository: {
        create: repository.create.bind(repository),
        getByIdForUser: repository.getByIdForUser.bind(repository),
        listByUserId: repository.listByUserId.bind(repository),
        updateForUser: repository.updateForUser.bind(repository),
        deleteForUser: repository.deleteForUser.bind(repository),
        adjustPageCount: repository.adjustPageCount.bind(repository),
        ...overrides,
      },
    },
  });
}

function replacePageRepository(overrides: Partial<KnowledgePageRepository>): void {
  const services = getServices();
  const repository = services.repositories.pageRepository;
  setServices({
    ...services,
    repositories: {
      ...services.repositories,
      pageRepository: {
        create: repository.create.bind(repository),
        getByIdForUser: repository.getByIdForUser.bind(repository),
        listByUserId: repository.listByUserId.bind(repository),
        updateForUser: repository.updateForUser.bind(repository),
        deleteForUser: repository.deleteForUser.bind(repository),
        ...overrides,
      },
    },
  });
}

function expectIsoTimestamp(value: unknown): void {
  expect(typeof value).toBe('string');
  expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  expect(Number.isNaN(Date.parse(value as string))).toBe(false);
}

describe('Fishing Assistant knowledge routes', () => {
  let ctx: RouteTestContext;

  beforeEach(async () => {
    process.env['NODE_ENV'] = 'test';
    authState.user = { userId: 'user-1', claims: { email: 'user@example.com' } };
    authState.logIncomingRequest.mockClear();
    const services = createServices();
    const app = await buildServer();
    await app.ready();
    ctx = { app, ...services };
  });

  afterEach(async () => {
    resetServices();
    await ctx.app.close();
  });

  it('requires authentication', async () => {
    authState.user = null;

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/folders',
    });

    expect(response.statusCode).toBe(401);
  });

  it('creates, lists, updates, and deletes folders for the authenticated user', async () => {
    const createResponse = await ctx.app.inject({
      method: 'POST',
      url: '/folders',
      payload: { name: 'Kurs', parentId: null, sortOrder: 0 },
    });
    const listResponse = await ctx.app.inject({ method: 'GET', url: '/folders' });
    const updateResponse = await ctx.app.inject({
      method: 'PATCH',
      url: '/folders/folder-1',
      payload: { name: 'Kurs główny', parentId: null, sortOrder: 2 },
    });
    const deleteResponse = await ctx.app.inject({
      method: 'DELETE',
      url: '/folders/folder-1',
    });

    expect(createResponse.statusCode).toBe(200);
    expect(listResponse.statusCode).toBe(200);
    expect(updateResponse.statusCode).toBe(200);
    expect(deleteResponse.statusCode).toBe(200);
    expect(createResponse.json().data.folder).toMatchObject({ id: 'folder-1', userId: 'user-1', name: 'Kurs' });
    expect(listResponse.json().data.items.map((folder: { id: string }) => folder.id)).toEqual(['folder-1']);
    expect(updateResponse.json().data.folder.name).toBe('Kurs główny');

    const createdFolder = createResponse.json().data.folder as { createdAt: unknown; updatedAt: unknown };
    const listedFolder = listResponse.json().data.items[0] as { createdAt: unknown; updatedAt: unknown };
    const updatedFolder = updateResponse.json().data.folder as { createdAt: unknown; updatedAt: unknown };
    for (const value of [
      createdFolder.createdAt,
      createdFolder.updatedAt,
      listedFolder.createdAt,
      listedFolder.updatedAt,
      updatedFolder.createdAt,
      updatedFolder.updatedAt,
    ]) {
      expectIsoTimestamp(value);
    }
  });

  it('validates folder write payloads', async () => {
    const createDefaultResponse = await ctx.app.inject({
      method: 'POST',
      url: '/folders',
      payload: { name: 'Defaults' },
    });
    const createResponse = await ctx.app.inject({
      method: 'POST',
      url: '/folders',
      payload: { name: '' },
    });
    const missingPayloadResponse = await ctx.app.inject({
      method: 'POST',
      url: '/folders',
    });
    const updateResponse = await ctx.app.inject({
      method: 'PATCH',
      url: '/folders/missing-folder',
      payload: { name: '' },
    });

    expect(createDefaultResponse.statusCode).toBe(200);
    expect(createResponse.statusCode).toBe(400);
    expect(missingPayloadResponse.statusCode).toBe(400);
    expect(updateResponse.statusCode).toBe(400);
    expect(createDefaultResponse.json().data.folder).toMatchObject({ parentId: null, sortOrder: 0 });
    expect(createResponse.json().error.code).toBe('INVALID_REQUEST');
    expect(missingPayloadResponse.json().error.code).toBe('INVALID_REQUEST');
    expect(updateResponse.json().error.code).toBe('INVALID_REQUEST');
  });

  it('returns conflict when deleting a folder that contains pages', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/folders',
      payload: { name: 'Kurs', parentId: null, sortOrder: 0 },
    });
    await ctx.app.inject({
      method: 'POST',
      url: '/pages',
      payload: { folderId: 'folder-1', rawText: 'Zanęta delikatna\n\n-300 g otrębów' },
    });

    const response = await ctx.app.inject({
      method: 'DELETE',
      url: '/folders/folder-1',
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('CONFLICT');
  });

  it('creates, lists, reads, updates, reindexes, and deletes pages', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/folders',
      payload: { name: 'Kurs', parentId: null, sortOrder: 0 },
    });
    const createResponse = await ctx.app.inject({
      method: 'POST',
      url: '/pages',
      payload: { folderId: 'folder-1', rawText: 'Zanęta delikatna\n\n-300 g otrębów' },
    });
    const listResponse = await ctx.app.inject({ method: 'GET', url: '/pages?folderId=folder-1' });
    const listAllResponse = await ctx.app.inject({ method: 'GET', url: '/pages' });
    const getResponse = await ctx.app.inject({ method: 'GET', url: '/pages/page-1' });
    const updateResponse = await ctx.app.inject({
      method: 'PATCH',
      url: '/pages/page-1',
      payload: { rawText: 'Zanęta wiosenna\n\n-150 g kukurydzy' },
    });
    const reindexResponse = await ctx.app.inject({
      method: 'POST',
      url: '/pages/page-1/reindex',
    });
    const deleteResponse = await ctx.app.inject({ method: 'DELETE', url: '/pages/page-1' });

    expect(createResponse.statusCode).toBe(200);
    expect(listResponse.statusCode).toBe(200);
    expect(listAllResponse.statusCode).toBe(200);
    expect(getResponse.statusCode).toBe(200);
    expect(updateResponse.statusCode).toBe(200);
    expect(reindexResponse.statusCode).toBe(200);
    expect(deleteResponse.statusCode).toBe(200);
    expect(createResponse.json().data.page).toMatchObject({ id: 'page-1', indexingStatus: 'ready' });
    expect(listResponse.json().data.items.map((page: { id: string }) => page.id)).toEqual(['page-1']);
    expect(listAllResponse.json().data.items.map((page: { id: string }) => page.id)).toEqual(['page-1']);
    expect(getResponse.json().data.page.rawText).toContain('Zanęta delikatna');
    expect(updateResponse.json().data.page.title).toBe('Zanęta wiosenna');

    const createdPage = createResponse.json().data.page as { createdAt: unknown; updatedAt: unknown };
    const listedPage = listResponse.json().data.items[0] as { createdAt: unknown; updatedAt: unknown };
    const listedAllPage = listAllResponse.json().data.items[0] as { createdAt: unknown; updatedAt: unknown };
    const fetchedPage = getResponse.json().data.page as { createdAt: unknown; updatedAt: unknown };
    const updatedPage = updateResponse.json().data.page as { createdAt: unknown; updatedAt: unknown };
    const reindexedPage = reindexResponse.json().data.page as { createdAt: unknown; updatedAt: unknown };
    for (const value of [
      createdPage.createdAt,
      createdPage.updatedAt,
      listedPage.createdAt,
      listedPage.updatedAt,
      listedAllPage.createdAt,
      listedAllPage.updatedAt,
      fetchedPage.createdAt,
      fetchedPage.updatedAt,
      updatedPage.createdAt,
      updatedPage.updatedAt,
      reindexedPage.createdAt,
      reindexedPage.updatedAt,
    ]) {
      expectIsoTimestamp(value);
    }
  });

  it('validates page payloads and returns not found for missing pages', async () => {
    const missingBody = await ctx.app.inject({
      method: 'POST',
      url: '/pages',
    });
    const missingFolderId = await ctx.app.inject({
      method: 'POST',
      url: '/pages',
      payload: { rawText: 'Text' },
    });
    const missingText = await ctx.app.inject({
      method: 'POST',
      url: '/pages',
      payload: { folderId: 'folder-1', rawText: '' },
    });
    const missingUpdateText = await ctx.app.inject({
      method: 'PATCH',
      url: '/pages/page-1',
      payload: { rawText: '' },
    });
    const missingPage = await ctx.app.inject({
      method: 'GET',
      url: '/pages/missing-page',
    });
    const missingUpdatePage = await ctx.app.inject({
      method: 'PATCH',
      url: '/pages/missing-page',
      payload: { rawText: 'Zanęta delikatna' },
    });
    const missingReindexPage = await ctx.app.inject({
      method: 'POST',
      url: '/pages/missing-page/reindex',
    });

    expect(missingBody.statusCode).toBe(400);
    expect(missingFolderId.statusCode).toBe(400);
    expect(missingText.statusCode).toBe(400);
    expect(missingUpdateText.statusCode).toBe(400);
    expect(missingPage.statusCode).toBe(404);
    expect(missingUpdatePage.statusCode).toBe(404);
    expect(missingReindexPage.statusCode).toBe(404);
  });

  it('maps page indexing errors to HTTP errors', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/folders',
      payload: { name: 'Kurs', parentId: null, sortOrder: 0 },
    });
    const oversizedText = `Duży dokument\n\n${Array.from({ length: 121 }, (_, index) => [
      `Sekcja ${String(index)}:`,
      '-100 g składnika',
    ].join('\n')).join('\n\n')}`;
    const oversized = await ctx.app.inject({
      method: 'POST',
      url: '/pages',
      payload: { folderId: 'folder-1', rawText: oversizedText },
    });

    expect(oversized.statusCode).toBe(400);
    expect(oversized.json().error.code).toBe('INVALID_REQUEST');
  });

  it('stores failed page state when embedding fails', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/folders',
      payload: { name: 'Kurs', parentId: null, sortOrder: 0 },
    });
    ctx.setEmbeddingFailure(true);

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/pages',
      payload: { folderId: 'folder-1', rawText: 'Zanęta delikatna\n\n-300 g otrębów' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.page).toMatchObject({
      indexingStatus: 'failed',
      indexingError: 'Embedding failed',
      chunkCount: 0,
    });
  });

  it('does not include raw page bodies in request log previews', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/folders',
      payload: { name: 'Kurs', parentId: null, sortOrder: 0 },
    });
    await ctx.app.inject({
      method: 'POST',
      url: '/pages',
      payload: { folderId: 'folder-1', rawText: 'sekretna treść zanęty' },
    });
    await ctx.app.inject({
      method: 'PATCH',
      url: '/pages/page-1',
      payload: { rawText: 'inna sekretna treść zanęty' },
    });

    expect(authState.logIncomingRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ bodyPreviewLength: 0 })
    );
    expect(authState.logIncomingRequest.mock.calls.some(([, options]) => options?.bodyPreviewLength === 0)).toBe(true);
  });

  it('maps internal failures through the shared knowledge error helper', () => {
    const reply = {
      fail: vi.fn().mockReturnValue('reply'),
    };

    const embeddingResult = sendKnowledgeError(reply as never, {
      code: 'EMBEDDING_FAILED',
      message: 'Embedding mismatch',
    });
    const firestoreResult = sendKnowledgeError(reply as never, {
      code: 'FIRESTORE_ERROR',
      message: 'Firestore failed',
    });
    const notFoundResult = sendKnowledgeError(reply as never, {
      code: 'NOT_FOUND',
      message: 'Missing',
    });

    expect(embeddingResult).toBe('reply');
    expect(firestoreResult).toBe('reply');
    expect(notFoundResult).toBe('reply');
    expect(reply.fail).toHaveBeenCalledWith('INTERNAL_ERROR', 'Embedding mismatch');
    expect(reply.fail).toHaveBeenCalledWith('INTERNAL_ERROR', 'Firestore failed');
    expect(reply.fail).toHaveBeenCalledWith('NOT_FOUND', 'Missing');
  });

  it('maps folder repository route failures to internal errors', async () => {
    replaceFolderRepository({
      listByUserId: vi.fn(async () => err({ code: 'FIRESTORE_ERROR' as const, message: 'list failed' })),
    });
    const listResponse = await ctx.app.inject({ method: 'GET', url: '/folders' });

    replaceFolderRepository({
      create: vi.fn(async () => err({ code: 'FIRESTORE_ERROR' as const, message: 'create failed' })),
    });
    const createResponse = await ctx.app.inject({
      method: 'POST',
      url: '/folders',
      payload: { name: 'Kurs' },
    });

    replaceFolderRepository({
      updateForUser: vi.fn(async () => err({ code: 'FIRESTORE_ERROR' as const, message: 'update failed' })),
    });
    const updateResponse = await ctx.app.inject({
      method: 'PATCH',
      url: '/folders/folder-1',
      payload: { name: 'Kurs' },
    });

    expect(listResponse.statusCode).toBe(500);
    expect(createResponse.statusCode).toBe(500);
    expect(updateResponse.statusCode).toBe(500);
  });

  it('maps page repository route failures to internal errors', async () => {
    replacePageRepository({
      listByUserId: vi.fn(async () => err({ code: 'FIRESTORE_ERROR' as const, message: 'page list failed' })),
    });
    const listResponse = await ctx.app.inject({ method: 'GET', url: '/pages' });

    replacePageRepository({
      getByIdForUser: vi.fn(async () => err({ code: 'FIRESTORE_ERROR' as const, message: 'page get failed' })),
    });
    const getResponse = await ctx.app.inject({ method: 'GET', url: '/pages/page-1' });

    replacePageRepository({
      deleteForUser: vi.fn(async () => err({ code: 'FIRESTORE_ERROR' as const, message: 'page delete failed' })),
    });
    const deleteResponse = await ctx.app.inject({ method: 'DELETE', url: '/pages/page-1' });

    expect(listResponse.statusCode).toBe(500);
    expect(getResponse.statusCode).toBe(500);
    expect(deleteResponse.statusCode).toBe(500);
  });
});
