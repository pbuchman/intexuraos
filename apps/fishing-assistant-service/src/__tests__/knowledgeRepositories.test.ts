import { describe, expect, it, vi } from 'vitest';
import { createFakeFirestore, type Firestore, Timestamp } from '@intexuraos/infra-firestore';
import type { Logger } from '@intexuraos/common-core';
import {
  createFirestoreChunkRepository,
} from '../infra/firestore/chunkRepository.js';
import {
  createFirestoreFolderRepository,
} from '../infra/firestore/folderRepository.js';
import {
  createFirestorePageRepository,
} from '../infra/firestore/pageRepository.js';
import type { KnowledgeChunkCreateInput } from '../domain/ports/knowledgeRepositories.js';
import {
  FISHING_KNOWLEDGE_CHUNKS_COLLECTION,
  FISHING_KNOWLEDGE_FOLDERS_COLLECTION,
  FISHING_KNOWLEDGE_PAGES_COLLECTION,
} from '../infra/firestore/collections.js';

const logger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function makeChunk(overrides: Partial<KnowledgeChunkCreateInput> = {}): KnowledgeChunkCreateInput {
  return {
    id: 'chunk-1',
    userId: 'user-1',
    pageId: 'page-1',
    folderId: 'folder-1',
    title: 'Spring bait',
    heading: 'Recipe',
    index: 0,
    text: 'Use light bait in spring.',
    searchableText: 'Folder: Course\nPage: Spring bait\nHeading: Recipe\nUse light bait in spring.',
    contentType: 'recipe',
    embedding: [0.1, 0.2, 0.3],
    embeddingModel: 'text-embedding-3-small',
    ...overrides,
  };
}

function configureFailingFirestore(): Firestore {
  const fake = createFakeFirestore();
  fake.configure({ errorToThrow: new Error('firestore failed') });
  return fake as unknown as Firestore;
}

describe('Fishing Assistant Firestore knowledge repositories', () => {
  it('lists folders by user and allows duplicate names for the same user', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const folders = createFirestoreFolderRepository({ firestore, logger });

    const first = await folders.create({
      id: 'folder-1',
      userId: 'user-1',
      name: 'Kurs',
      parentId: null,
      sortOrder: 0,
    });
    const second = await folders.create({
      id: 'folder-2',
      userId: 'user-1',
      name: 'Kurs',
      parentId: null,
      sortOrder: 1,
    });
    await folders.create({
      id: 'folder-other',
      userId: 'other-user',
      name: 'Kurs',
      parentId: null,
      sortOrder: 0,
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    const result = await folders.listByUserId('user-1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((folder) => folder.id)).toEqual(['folder-2', 'folder-1']);
    expect(result.value.map((folder) => folder.name)).toEqual(['Kurs', 'Kurs']);
  });

  it('maps sparse folder documents with defaults and returns null for foreign folders', async () => {
    const fake = createFakeFirestore();
    fake.seedCollection(FISHING_KNOWLEDGE_FOLDERS_COLLECTION, [
      {
        id: 'folder-sparse',
        data: {
          userId: 'user-1',
          name: 42,
          parentId: 123,
          sortOrder: 'first',
          pageCount: 'many',
          createdAt: 'not-a-timestamp',
          updatedAt: 'not-a-timestamp',
        },
      },
      {
        id: 'folder-foreign',
        data: {
          userId: 'other-user',
          name: 'Foreign',
          parentId: null,
          sortOrder: 0,
          pageCount: 0,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        },
      },
    ]);
    const folders = createFirestoreFolderRepository({ firestore: fake as unknown as Firestore, logger });

    const sparse = await folders.getByIdForUser({ userId: 'user-1', folderId: 'folder-sparse' });
    const foreign = await folders.getByIdForUser({ userId: 'user-1', folderId: 'folder-foreign' });
    const missing = await folders.getByIdForUser({ userId: 'user-1', folderId: 'missing-folder' });

    expect(sparse.ok).toBe(true);
    expect(foreign.ok).toBe(true);
    expect(missing.ok).toBe(true);
    if (!sparse.ok || !foreign.ok || !missing.ok) return;
    expect(sparse.value).toMatchObject({
      id: 'folder-sparse',
      userId: 'user-1',
      name: '',
      parentId: null,
      sortOrder: 0,
      pageCount: 0,
    });
    expect(sparse.value?.createdAt.toMillis()).toBe(0);
    expect(sparse.value?.updatedAt.toMillis()).toBe(0);
    expect(foreign.value).toBeNull();
    expect(missing.value).toBeNull();
  });

  it('adjusts folder page counts without dropping below zero', async () => {
    const fake = createFakeFirestore();
    const folders = createFirestoreFolderRepository({ firestore: fake as unknown as Firestore, logger });
    await folders.create({
      id: 'folder-1',
      userId: 'user-1',
      name: 'Kurs',
      parentId: 'parent-folder',
      sortOrder: 0,
    });
    fake.seedCollection(FISHING_KNOWLEDGE_FOLDERS_COLLECTION, [
      {
        id: 'folder-malformed-count',
        data: {
          userId: 'user-1',
          name: 'Malformed',
          parentId: null,
          sortOrder: 1,
          pageCount: 'not-a-number',
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        },
      },
    ]);

    const incremented = await folders.adjustPageCount({
      userId: 'user-1',
      folderId: 'folder-1',
      delta: 2,
    });
    const decremented = await folders.adjustPageCount({
      userId: 'user-1',
      folderId: 'folder-1',
      delta: -5,
    });
    const malformed = await folders.adjustPageCount({
      userId: 'user-1',
      folderId: 'folder-malformed-count',
      delta: 3,
    });
    const folder = await folders.getByIdForUser({ userId: 'user-1', folderId: 'folder-1' });
    const malformedFolder = await folders.getByIdForUser({
      userId: 'user-1',
      folderId: 'folder-malformed-count',
    });

    expect(incremented.ok).toBe(true);
    expect(decremented.ok).toBe(true);
    expect(malformed.ok).toBe(true);
    expect(folder.ok).toBe(true);
    expect(malformedFolder.ok).toBe(true);
    if (!folder.ok || !malformedFolder.ok) return;
    expect(folder.value?.parentId).toBe('parent-folder');
    expect(folder.value?.pageCount).toBe(0);
    expect(malformedFolder.value?.pageCount).toBe(3);
  });

  it('updates and deletes folders while preventing non-empty folder deletion', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const folders = createFirestoreFolderRepository({ firestore, logger });
    const pages = createFirestorePageRepository({ firestore, logger });
    await folders.create({ id: 'folder-1', userId: 'user-1', name: 'Kurs', parentId: null, sortOrder: 0 });
    await folders.create({ id: 'folder-empty', userId: 'user-1', name: 'Empty', parentId: null, sortOrder: 1 });
    await pages.create({
      id: 'page-1',
      userId: 'user-1',
      folderId: 'folder-1',
      title: 'Page',
      rawText: 'Raw',
      normalizedText: 'Raw',
      contentType: 'other',
      indexingStatus: 'ready',
      chunkCount: 0,
    });

    const updated = await folders.updateForUser({
      id: 'folder-1',
      userId: 'user-1',
      name: 'Updated',
      parentId: 'parent-folder',
      sortOrder: 5,
    });
    const notFoundUpdate = await folders.updateForUser({
      id: 'missing-folder',
      userId: 'user-1',
      name: 'Missing',
      parentId: null,
      sortOrder: 0,
    });
    const nonEmptyDelete = await folders.deleteForUser({ userId: 'user-1', folderId: 'folder-1' });
    const missingDelete = await folders.deleteForUser({ userId: 'user-1', folderId: 'missing-folder' });
    const deleted = await folders.deleteForUser({ userId: 'user-1', folderId: 'folder-empty' });
    const deletedFolder = await folders.getByIdForUser({ userId: 'user-1', folderId: 'folder-empty' });

    expect(updated.ok).toBe(true);
    expect(notFoundUpdate.ok).toBe(false);
    expect(nonEmptyDelete.ok).toBe(false);
    expect(missingDelete.ok).toBe(false);
    expect(deleted.ok).toBe(true);
    expect(deletedFolder.ok).toBe(true);
    if (!updated.ok || notFoundUpdate.ok || nonEmptyDelete.ok || missingDelete.ok || !deletedFolder.ok) return;
    expect(updated.value).toMatchObject({
      id: 'folder-1',
      name: 'Updated',
      parentId: 'parent-folder',
      sortOrder: 5,
    });
    expect(notFoundUpdate.error.code).toBe('NOT_FOUND');
    expect(nonEmptyDelete.error.code).toBe('FOLDER_NOT_EMPTY');
    expect(missingDelete.error.code).toBe('NOT_FOUND');
    expect(deletedFolder.value).toBeNull();
  });

  it('rejects page count updates for folders owned by another user', async () => {
    const fake = createFakeFirestore();
    fake.seedCollection(FISHING_KNOWLEDGE_FOLDERS_COLLECTION, [
      {
        id: 'folder-foreign',
        data: {
          userId: 'other-user',
          name: 'Foreign',
          parentId: null,
          sortOrder: 0,
          pageCount: 0,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        },
      },
    ]);
    const folders = createFirestoreFolderRepository({ firestore: fake as unknown as Firestore, logger });

    const result = await folders.adjustPageCount({
      userId: 'user-1',
      folderId: 'folder-foreign',
      delta: 1,
    });
    fake.clear();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('FIRESTORE_ERROR');
  });

  it('creates pages with raw and normalized text and updates folder page count', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const folders = createFirestoreFolderRepository({ firestore, logger });
    const pages = createFirestorePageRepository({ firestore, logger });
    await folders.create({
      id: 'folder-1',
      userId: 'user-1',
      name: 'Kurs',
      parentId: null,
      sortOrder: 0,
    });

    const created = await pages.create({
      id: 'page-1',
      userId: 'user-1',
      folderId: 'folder-1',
      title: 'Zanęta delikatna',
      rawText: 'Zanęta delikatna\r\n-300 g otrębów',
      normalizedText: 'Zanęta delikatna\n- 300 g otrębów',
      contentType: 'recipe',
      indexingStatus: 'ready',
      chunkCount: 1,
    });

    expect(created.ok).toBe(true);
    const page = await pages.getByIdForUser({ userId: 'user-1', pageId: 'page-1' });
    const folder = await folders.getByIdForUser({ userId: 'user-1', folderId: 'folder-1' });

    expect(page.ok).toBe(true);
    expect(folder.ok).toBe(true);
    if (!page.ok || !folder.ok) return;
    expect(page.value?.rawText).toBe('Zanęta delikatna\r\n-300 g otrębów');
    expect(page.value?.normalizedText).toBe('Zanęta delikatna\n- 300 g otrębów');
    expect(page.value?.indexingStatus).toBe('ready');
    expect(folder.value?.pageCount).toBe(1);
  });

  it('stores optional page indexing errors and maps sparse page documents with defaults', async () => {
    const fake = createFakeFirestore();
    const folders = createFirestoreFolderRepository({ firestore: fake as unknown as Firestore, logger });
    const pages = createFirestorePageRepository({ firestore: fake as unknown as Firestore, logger });
    await folders.create({
      id: 'folder-1',
      userId: 'user-1',
      name: 'Kurs',
      parentId: null,
      sortOrder: 0,
    });

    const failed = await pages.create({
      id: 'page-failed',
      userId: 'user-1',
      folderId: 'folder-1',
      title: 'Failed page',
      rawText: 'Raw',
      normalizedText: 'Raw',
      contentType: 'other',
      indexingStatus: 'failed',
      indexingError: 'Embedding failed',
      chunkCount: 0,
    });
    fake.seedCollection(FISHING_KNOWLEDGE_PAGES_COLLECTION, [
      {
        id: 'page-sparse',
        data: {
          userId: 'user-1',
          createdAt: 'not-a-timestamp',
          updatedAt: 'not-a-timestamp',
        },
      },
      {
        id: 'page-foreign',
        data: {
          userId: 'other-user',
        },
      },
    ]);

    const failedPage = await pages.getByIdForUser({ userId: 'user-1', pageId: 'page-failed' });
    const sparse = await pages.getByIdForUser({ userId: 'user-1', pageId: 'page-sparse' });
    const foreign = await pages.getByIdForUser({ userId: 'user-1', pageId: 'page-foreign' });
    const missing = await pages.getByIdForUser({ userId: 'user-1', pageId: 'missing-page' });

    expect(failed.ok).toBe(true);
    expect(failedPage.ok).toBe(true);
    expect(sparse.ok).toBe(true);
    expect(foreign.ok).toBe(true);
    expect(missing.ok).toBe(true);
    if (!failedPage.ok || !sparse.ok || !foreign.ok || !missing.ok) return;
    expect(failedPage.value?.indexingError).toBe('Embedding failed');
    expect(sparse.value).toMatchObject({
      id: 'page-sparse',
      userId: 'user-1',
      folderId: '',
      title: '',
      rawText: '',
      normalizedText: '',
      contentType: 'other',
      indexingStatus: 'pending',
      chunkCount: 0,
    });
    expect(sparse.value?.createdAt.toMillis()).toBe(0);
    expect(sparse.value?.updatedAt.toMillis()).toBe(0);
    expect(foreign.value).toBeNull();
    expect(missing.value).toBeNull();
  });

  it('lists pages by user and updates page indexing fields', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const folders = createFirestoreFolderRepository({ firestore, logger });
    const pages = createFirestorePageRepository({ firestore, logger });
    await folders.create({ id: 'folder-1', userId: 'user-1', name: 'Kurs', parentId: null, sortOrder: 0 });
    await folders.create({ id: 'folder-2', userId: 'user-1', name: 'Other', parentId: null, sortOrder: 1 });
    await pages.create({
      id: 'page-1',
      userId: 'user-1',
      folderId: 'folder-1',
      title: 'Page 1',
      rawText: 'Raw',
      normalizedText: 'Raw',
      contentType: 'other',
      indexingStatus: 'failed',
      indexingError: 'old error',
      chunkCount: 0,
    });
    await pages.create({
      id: 'page-2',
      userId: 'user-1',
      folderId: 'folder-2',
      title: 'Page 2',
      rawText: 'Raw',
      normalizedText: 'Raw',
      contentType: 'other',
      indexingStatus: 'ready',
      chunkCount: 0,
    });

    const allPages = await pages.listByUserId({ userId: 'user-1' });
    const folderPages = await pages.listByUserId({ userId: 'user-1', folderId: 'folder-1' });
    const updated = await pages.updateForUser({
      userId: 'user-1',
      pageId: 'page-1',
      title: 'Updated',
      rawText: 'Updated raw',
      normalizedText: 'Updated normalized',
      contentType: 'recipe',
      indexingStatus: 'ready',
      indexingError: null,
      chunkCount: 2,
    });
    const notFound = await pages.updateForUser({
      userId: 'user-1',
      pageId: 'missing-page',
      title: 'Missing',
    });
    const titleOnly = await pages.updateForUser({
      userId: 'user-1',
      pageId: 'page-2',
      title: 'Title only',
    });
    const statusOnly = await pages.updateForUser({
      userId: 'user-1',
      pageId: 'page-2',
      indexingStatus: 'failed',
    });

    expect(allPages.ok).toBe(true);
    expect(folderPages.ok).toBe(true);
    expect(updated.ok).toBe(true);
    expect(notFound.ok).toBe(false);
    expect(titleOnly.ok).toBe(true);
    expect(statusOnly.ok).toBe(true);
    if (!allPages.ok || !folderPages.ok || !updated.ok || notFound.ok || !titleOnly.ok || !statusOnly.ok) return;
    expect(allPages.value.map((page) => page.id).sort()).toEqual(['page-1', 'page-2']);
    expect(folderPages.value.map((page) => page.id)).toEqual(['page-1']);
    expect(updated.value).toMatchObject({
      id: 'page-1',
      title: 'Updated',
      rawText: 'Updated raw',
      normalizedText: 'Updated normalized',
      contentType: 'recipe',
      indexingStatus: 'ready',
      chunkCount: 2,
    });
    expect(updated.value.indexingError).toBeUndefined();
    expect(notFound.error.code).toBe('NOT_FOUND');
    expect(titleOnly.value.title).toBe('Title only');
    expect(titleOnly.value.rawText).toBe('Raw');
    expect(statusOnly.value.title).toBe('Title only');
    expect(statusOnly.value.indexingStatus).toBe('failed');
  });

  it('replaces chunks only for the requested user and page', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const chunks = createFirestoreChunkRepository({ firestore, logger });
    await chunks.replaceForPage({
      userId: 'user-1',
      pageId: 'page-1',
      chunks: [makeChunk({ id: 'old-user-chunk', text: 'old', searchableText: 'old' })],
    });
    await chunks.replaceForPage({
      userId: 'other-user',
      pageId: 'page-1',
      chunks: [
        makeChunk({
          id: 'foreign-chunk',
          userId: 'other-user',
          text: 'foreign',
          searchableText: 'foreign',
        }),
      ],
    });

    const replaced = await chunks.replaceForPage({
      userId: 'user-1',
      pageId: 'page-1',
      chunks: [makeChunk({ id: 'new-user-chunk', text: 'new', searchableText: 'new' })],
    });

    expect(replaced.ok).toBe(true);
    const userChunks = await chunks.findByPageId({ userId: 'user-1', pageId: 'page-1' });
    const foreignChunks = await chunks.findByPageId({ userId: 'other-user', pageId: 'page-1' });
    expect(userChunks.ok).toBe(true);
    expect(foreignChunks.ok).toBe(true);
    if (!userChunks.ok || !foreignChunks.ok) return;
    expect(userChunks.value.map((chunk) => chunk.id)).toEqual(['new-user-chunk']);
    expect(foreignChunks.value.map((chunk) => chunk.id)).toEqual(['foreign-chunk']);
  });

  it('maps sparse chunks with defaults and deletes chunks for a page', async () => {
    const fake = createFakeFirestore();
    fake.seedCollection(FISHING_KNOWLEDGE_CHUNKS_COLLECTION, [
      {
        id: 'chunk-sparse',
        data: {
          userId: 'user-1',
          pageId: 'page-1',
          index: null,
          createdAt: 'not-a-timestamp',
        },
      },
      {
        id: 'chunk-deleted',
        data: {
          ...makeChunk({ id: 'chunk-deleted', heading: null }),
          createdAt: Timestamp.now(),
        },
      },
    ]);
    const chunks = createFirestoreChunkRepository({ firestore: fake as unknown as Firestore, logger });

    const found = await chunks.findByPageId({ userId: 'user-1', pageId: 'page-1' });
    const deleted = await chunks.deleteByPageId({ userId: 'user-1', pageId: 'page-1' });
    const afterDelete = await chunks.findByPageId({ userId: 'user-1', pageId: 'page-1' });

    expect(found.ok).toBe(true);
    expect(deleted.ok).toBe(true);
    expect(afterDelete.ok).toBe(true);
    if (!found.ok || !afterDelete.ok) return;
    expect(found.value.map((chunk) => chunk.id)).toEqual(['chunk-sparse', 'chunk-deleted']);
    expect(found.value[0]).toMatchObject({
      id: 'chunk-sparse',
      userId: 'user-1',
      pageId: 'page-1',
      folderId: '',
      title: '',
      heading: null,
      index: 0,
      text: '',
      searchableText: '',
      contentType: 'other',
      embeddingModel: '',
    });
    expect(found.value[0]?.createdAt.toMillis()).toBe(0);
    expect(afterDelete.value).toEqual([]);
  });

  it('deletes a page, its user-scoped chunks, and decrements folder page count', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const folders = createFirestoreFolderRepository({ firestore, logger });
    const pages = createFirestorePageRepository({ firestore, logger });
    const chunks = createFirestoreChunkRepository({ firestore, logger });
    await folders.create({ id: 'folder-1', userId: 'user-1', name: 'Kurs', parentId: null, sortOrder: 0 });
    await pages.create({
      id: 'page-1',
      userId: 'user-1',
      folderId: 'folder-1',
      title: 'Page',
      rawText: 'Raw',
      normalizedText: 'Raw',
      contentType: 'other',
      indexingStatus: 'ready',
      chunkCount: 1,
    });
    await chunks.replaceForPage({ userId: 'user-1', pageId: 'page-1', chunks: [makeChunk()] });

    const deleted = await pages.deleteForUser({ userId: 'user-1', pageId: 'page-1' });

    expect(deleted.ok).toBe(true);
    const page = await pages.getByIdForUser({ userId: 'user-1', pageId: 'page-1' });
    const pageChunks = await chunks.findByPageId({ userId: 'user-1', pageId: 'page-1' });
    const folder = await folders.getByIdForUser({ userId: 'user-1', folderId: 'folder-1' });
    expect(page.ok).toBe(true);
    expect(pageChunks.ok).toBe(true);
    expect(folder.ok).toBe(true);
    if (!page.ok || !pageChunks.ok || !folder.ok) return;
    expect(page.value).toBeNull();
    expect(pageChunks.value).toEqual([]);
    expect(folder.value?.pageCount).toBe(0);
  });

  it('treats page deletion as user-scoped and tolerates missing folder records', async () => {
    const fake = createFakeFirestore();
    fake.seedCollection(FISHING_KNOWLEDGE_PAGES_COLLECTION, [
      {
        id: 'foreign-page',
        data: {
          userId: 'other-user',
          folderId: 'folder-1',
          title: 'Foreign',
          rawText: 'Raw',
          normalizedText: 'Raw',
          contentType: 'other',
          indexingStatus: 'ready',
          chunkCount: 0,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        },
      },
      {
        id: 'page-with-missing-folder',
        data: {
          userId: 'user-1',
          folderId: 'missing-folder',
          title: 'Missing folder',
          rawText: 'Raw',
          normalizedText: 'Raw',
          contentType: 'other',
          indexingStatus: 'ready',
          chunkCount: 0,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        },
      },
      {
        id: 'page-without-folder',
        data: {
          userId: 'user-1',
          folderId: 123,
          title: 'No folder',
          rawText: 'Raw',
          normalizedText: 'Raw',
          contentType: 'other',
          indexingStatus: 'ready',
          chunkCount: 0,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        },
      },
    ]);
    const pages = createFirestorePageRepository({ firestore: fake as unknown as Firestore, logger });

    const missing = await pages.deleteForUser({ userId: 'user-1', pageId: 'missing-page' });
    const foreign = await pages.deleteForUser({ userId: 'user-1', pageId: 'foreign-page' });
    const missingFolder = await pages.deleteForUser({ userId: 'user-1', pageId: 'page-with-missing-folder' });
    const withoutFolder = await pages.deleteForUser({ userId: 'user-1', pageId: 'page-without-folder' });

    expect(missing.ok).toBe(true);
    expect(foreign.ok).toBe(true);
    expect(missingFolder.ok).toBe(true);
    expect(withoutFolder.ok).toBe(true);
    const foreignAfterDelete = await pages.getByIdForUser({ userId: 'other-user', pageId: 'foreign-page' });
    expect(foreignAfterDelete.ok).toBe(true);
    if (!foreignAfterDelete.ok) return;
    expect(foreignAfterDelete.value?.title).toBe('Foreign');
  });

  it('creates and deletes pages when folder page count is malformed', async () => {
    const fake = createFakeFirestore();
    fake.seedCollection(FISHING_KNOWLEDGE_FOLDERS_COLLECTION, [
      {
        id: 'folder-1',
        data: {
          userId: 'user-1',
          name: 'Kurs',
          parentId: null,
          sortOrder: 0,
          pageCount: 'not-a-number',
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        },
      },
    ]);
    const folders = createFirestoreFolderRepository({ firestore: fake as unknown as Firestore, logger });
    const pages = createFirestorePageRepository({ firestore: fake as unknown as Firestore, logger });

    const created = await pages.create({
      id: 'page-1',
      userId: 'user-1',
      folderId: 'folder-1',
      title: 'Page',
      rawText: 'Raw',
      normalizedText: 'Raw',
      contentType: 'other',
      indexingStatus: 'ready',
      chunkCount: 0,
    });
    fake.seedCollection(FISHING_KNOWLEDGE_FOLDERS_COLLECTION, [
      {
        id: 'folder-1',
        data: {
          userId: 'user-1',
          name: 'Kurs',
          parentId: null,
          sortOrder: 0,
          pageCount: 'not-a-number',
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        },
      },
    ]);
    const deleted = await pages.deleteForUser({ userId: 'user-1', pageId: 'page-1' });
    const folder = await folders.getByIdForUser({ userId: 'user-1', folderId: 'folder-1' });

    expect(created.ok).toBe(true);
    expect(deleted.ok).toBe(true);
    expect(folder.ok).toBe(true);
    if (!folder.ok) return;
    expect(folder.value?.pageCount).toBe(0);
  });

  it('returns errors when creating pages or adjusting counts for missing folders', async () => {
    const pageFake = createFakeFirestore();
    const pages = createFirestorePageRepository({ firestore: pageFake as unknown as Firestore, logger });

    const pageResult = await pages.create({
      id: 'page-1',
      userId: 'user-1',
      folderId: 'missing-folder',
      title: 'Page',
      rawText: 'Raw',
      normalizedText: 'Raw',
      contentType: 'other',
      indexingStatus: 'ready',
      chunkCount: 0,
    });
    pageFake.clear();

    const folderFake = createFakeFirestore();
    const folders = createFirestoreFolderRepository({ firestore: folderFake as unknown as Firestore, logger });
    const countResult = await folders.adjustPageCount({
      userId: 'user-1',
      folderId: 'missing-folder',
      delta: 1,
    });
    folderFake.clear();

    expect(pageResult.ok).toBe(false);
    expect(countResult.ok).toBe(false);
    if (pageResult.ok || countResult.ok) return;
    expect(pageResult.error.code).toBe('FIRESTORE_ERROR');
    expect(countResult.error.code).toBe('FIRESTORE_ERROR');
  });

  it('queries nearest chunks through userId prefilter and drops foreign-user matches defensively', async () => {
    const docs = [
      {
        id: 'own',
        data: (): Record<string, unknown> => ({
          ...makeChunk({ id: 'own' }),
          createdAt: Timestamp.now(),
          vectorDistance: 0.2,
        }),
      },
      {
        id: 'foreign',
        data: (): Record<string, unknown> => ({
          ...makeChunk({ id: 'foreign', userId: 'other-user' }),
          createdAt: Timestamp.now(),
          vectorDistance: 0.1,
        }),
      },
    ];
    const get = vi.fn().mockResolvedValue({ empty: false, docs });
    const findNearest = vi.fn().mockReturnValue({ get });
    const where = vi.fn().mockReturnValue({ findNearest });
    const collection = vi.fn().mockReturnValue({ where });
    const firestore = { collection } as unknown as Firestore;
    const chunks = createFirestoreChunkRepository({ firestore, logger });

    const result = await chunks.findNearestByUserId({
      userId: 'user-1',
      embedding: [0.1, 0.2, 0.3],
      limit: 5,
    });

    expect(where).toHaveBeenCalledWith('userId', '==', 'user-1');
    expect(findNearest).toHaveBeenCalledWith(
      expect.objectContaining({
        vectorField: 'embedding',
        limit: 5,
        distanceMeasure: 'COSINE',
        distanceResultField: 'vectorDistance',
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((chunk) => ({ id: chunk.id, vectorScore: chunk.vectorScore }))).toEqual([
      { id: 'own', vectorScore: 0.8 },
    ]);
  });

  it('defaults vector score and chunk fields when nearest result omits optional data', async () => {
    const docs = [
      {
        id: 'own',
        data: (): Record<string, unknown> => ({
          userId: 'user-1',
          pageId: 'page-1',
        }),
      },
      {
        id: 'empty',
        data: (): undefined => undefined,
      },
    ];
    const get = vi.fn().mockResolvedValue({ docs });
    const findNearest = vi.fn().mockReturnValue({ get });
    const where = vi.fn().mockReturnValue({ findNearest });
    const collection = vi.fn().mockReturnValue({ where });
    const firestore = { collection } as unknown as Firestore;
    const chunks = createFirestoreChunkRepository({ firestore, logger });

    const result = await chunks.findNearestByUserId({
      userId: 'user-1',
      embedding: [0.1, 0.2, 0.3],
      limit: 5,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]).toMatchObject({
      id: 'own',
      userId: 'user-1',
      pageId: 'page-1',
      folderId: '',
      title: '',
      heading: null,
      index: 0,
      text: '',
      searchableText: '',
      contentType: 'other',
      embeddingModel: '',
      vectorScore: 0,
    });
    expect(result.value[0]?.createdAt.toMillis()).toBe(0);
  });

  it('returns firestore errors from repository failures', async () => {
    const firestore = configureFailingFirestore();
    const folders = createFirestoreFolderRepository({ firestore, logger });
    const pages = createFirestorePageRepository({ firestore, logger });
    const chunks = createFirestoreChunkRepository({ firestore, logger });

    const results = [
      await folders.create({ id: 'folder-1', userId: 'user-1', name: 'Kurs', parentId: null, sortOrder: 0 }),
      await folders.getByIdForUser({ userId: 'user-1', folderId: 'folder-1' }),
      await folders.listByUserId('user-1'),
      await folders.adjustPageCount({ userId: 'user-1', folderId: 'folder-1', delta: 1 }),
      await folders.updateForUser({ id: 'folder-1', userId: 'user-1', name: 'Kurs', parentId: null, sortOrder: 0 }),
      await folders.deleteForUser({ userId: 'user-1', folderId: 'folder-1' }),
      await pages.create({
        id: 'page-1',
        userId: 'user-1',
        folderId: 'folder-1',
        title: 'Page',
        rawText: 'Raw',
        normalizedText: 'Raw',
        contentType: 'other',
        indexingStatus: 'ready',
        chunkCount: 0,
      }),
      await pages.getByIdForUser({ userId: 'user-1', pageId: 'page-1' }),
      await pages.listByUserId({ userId: 'user-1' }),
      await pages.updateForUser({ userId: 'user-1', pageId: 'page-1', title: 'Updated' }),
      await pages.deleteForUser({ userId: 'user-1', pageId: 'page-1' }),
      await chunks.replaceForPage({ userId: 'user-1', pageId: 'page-1', chunks: [makeChunk()] }),
      await chunks.findByPageId({ userId: 'user-1', pageId: 'page-1' }),
      await chunks.deleteByPageId({ userId: 'user-1', pageId: 'page-1' }),
      await chunks.findNearestByUserId({ userId: 'user-1', embedding: [0.1], limit: 1 }),
    ];

    expect(results.every((result) => result.ok === false)).toBe(true);
    for (const result of results) {
      if (result.ok) return;
      expect(result.error.code).toBe('FIRESTORE_ERROR');
      expect(result.error.message).toContain('firestore failed');
    }
  });
});
