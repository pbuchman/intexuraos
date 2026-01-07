import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import { FirestoreBookmarkRepository } from '../infra/firestore/firestoreBookmarkRepository.js';
import type { BookmarkRepository } from '../domain/ports/bookmarkRepository.js';
import type { Bookmark, CreateBookmarkInput, OpenGraphPreview } from '../domain/models/bookmark.js';

function createTestInput(overrides: Partial<CreateBookmarkInput> = {}): CreateBookmarkInput {
  return {
    userId: 'user-123',
    url: 'https://example.com/article',
    source: 'web',
    sourceId: 'web-123',
    ...overrides,
  };
}

function createFullBookmark(id: string, overrides: Partial<Bookmark> = {}): Bookmark {
  const now = new Date();
  return {
    id,
    userId: 'user-123',
    url: 'https://example.com/article',
    title: 'Test Bookmark',
    description: 'Test description',
    tags: ['test'],
    ogPreview: null,
    ogFetchedAt: null,
    ogFetchStatus: 'pending',
    aiSummary: null,
    aiSummarizedAt: null,
    source: 'web',
    sourceId: 'web-123',
    archived: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('FirestoreBookmarkRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let repository: BookmarkRepository;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Parameters<typeof setFirestore>[0]);
    repository = new FirestoreBookmarkRepository();
  });

  afterEach(() => {
    resetFirestore();
  });

  describe('create', () => {
    it('creates a new bookmark successfully', async () => {
      const input = createTestInput();

      const result = await repository.create(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBeDefined();
        expect(result.value.userId).toBe('user-123');
        expect(result.value.url).toBe('https://example.com/article');
        expect(result.value.source).toBe('web');
        expect(result.value.sourceId).toBe('web-123');
        expect(result.value.ogFetchStatus).toBe('pending');
        expect(result.value.archived).toBe(false);
        expect(result.value.createdAt).toBeInstanceOf(Date);
        expect(result.value.updatedAt).toBeInstanceOf(Date);
      }
    });

    it('creates bookmark with default null values', async () => {
      const input = createTestInput();

      const result = await repository.create(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBeNull();
        expect(result.value.description).toBeNull();
        expect(result.value.ogPreview).toBeNull();
        expect(result.value.ogFetchedAt).toBeNull();
        expect(result.value.aiSummary).toBeNull();
        expect(result.value.aiSummarizedAt).toBeNull();
      }
    });

    it('creates bookmark with optional fields', async () => {
      const input = createTestInput({
        title: 'Custom Title',
        description: 'Custom Description',
        tags: ['work', 'important'],
      });

      const result = await repository.create(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Custom Title');
        expect(result.value.description).toBe('Custom Description');
        expect(result.value.tags).toEqual(['work', 'important']);
      }
    });

    it('creates bookmark with empty tags', async () => {
      const input = createTestInput({ tags: [] });

      const result = await repository.create(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.tags).toEqual([]);
      }
    });

    it('generates unique ids for each bookmark', async () => {
      const result1 = await repository.create(createTestInput());
      const result2 = await repository.create(
        createTestInput({ url: 'https://example.com/other' })
      );

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (result1.ok && result2.ok) {
        expect(result1.value.id).not.toBe(result2.value.id);
      }
    });
  });

  describe('findById', () => {
    it('returns null for non-existent bookmark', async () => {
      const result = await repository.findById('nonexistent-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns bookmark for existing id', async () => {
      const createResult = await repository.create(createTestInput({ title: 'Test Bookmark' }));
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const result = await repository.findById(createResult.value.id);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toBeNull();
        expect(result.value?.id).toBe(createResult.value.id);
        expect(result.value?.title).toBe('Test Bookmark');
      }
    });

    it('returns bookmark with correct date types', async () => {
      const createResult = await repository.create(createTestInput());
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const result = await repository.findById(createResult.value.id);

      expect(result.ok).toBe(true);
      if (result.ok && result.value) {
        expect(result.value.createdAt).toBeInstanceOf(Date);
        expect(result.value.updatedAt).toBeInstanceOf(Date);
      }
    });

    it('converts nullable date fields correctly', async () => {
      const createResult = await repository.create(createTestInput());
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const ogFetchedAt = new Date('2025-01-15T10:00:00Z');
      const aiSummarizedAt = new Date('2025-01-15T11:00:00Z');
      const bookmarkWithDates = createFullBookmark(createResult.value.id, {
        ...createResult.value,
        ogFetchedAt,
        aiSummarizedAt,
      });
      await repository.update(createResult.value.id, bookmarkWithDates);

      const result = await repository.findById(createResult.value.id);

      expect(result.ok).toBe(true);
      if (result.ok && result.value) {
        expect(result.value.ogFetchedAt).toBeInstanceOf(Date);
        expect(result.value.ogFetchedAt?.toISOString()).toBe(ogFetchedAt.toISOString());
        expect(result.value.aiSummarizedAt).toBeInstanceOf(Date);
        expect(result.value.aiSummarizedAt?.toISOString()).toBe(aiSummarizedAt.toISOString());
      }
    });

    it('handles null optional fields correctly', async () => {
      const createResult = await repository.create(createTestInput());
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const result = await repository.findById(createResult.value.id);

      expect(result.ok).toBe(true);
      if (result.ok && result.value) {
        expect(result.value.ogPreview).toBeNull();
        expect(result.value.ogFetchedAt).toBeNull();
        expect(result.value.aiSummary).toBeNull();
        expect(result.value.aiSummarizedAt).toBeNull();
      }
    });
  });

  describe('findByUserId', () => {
    it('returns empty array for user with no bookmarks', async () => {
      const result = await repository.findByUserId('nonexistent-user');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });

    it('returns bookmarks for specified user without filters', async () => {
      await repository.create(createTestInput({ userId: 'user-A', url: 'https://a.com/1' }));
      await repository.create(createTestInput({ userId: 'user-A', url: 'https://a.com/2' }));
      await repository.create(createTestInput({ userId: 'user-B', url: 'https://b.com/1' }));

      const resultA = await repository.findByUserId('user-A');

      expect(resultA.ok).toBe(true);
      if (resultA.ok) {
        expect(resultA.value).toHaveLength(2);
        expect(resultA.value.every((b) => b.userId === 'user-A')).toBe(true);
      }
    });

    it('isolates users - does not return other users bookmarks', async () => {
      await repository.create(createTestInput({ userId: 'user-A', url: 'https://a.com' }));
      await repository.create(createTestInput({ userId: 'user-B', url: 'https://b.com' }));
      await repository.create(createTestInput({ userId: 'user-A', url: 'https://a2.com' }));

      const resultA = await repository.findByUserId('user-A');
      const resultB = await repository.findByUserId('user-B');

      expect(resultA.ok).toBe(true);
      expect(resultB.ok).toBe(true);
      if (resultA.ok && resultB.ok) {
        expect(resultA.value).toHaveLength(2);
        expect(resultB.value).toHaveLength(1);
        expect(resultA.value.every((b) => b.userId === 'user-A')).toBe(true);
        expect(resultB.value.every((b) => b.userId === 'user-B')).toBe(true);
      }
    });

    it('filters by archived: true', async () => {
      const createResult = await repository.create(createTestInput());
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const archived = createFullBookmark(createResult.value.id, {
        ...createResult.value,
        archived: true,
      });
      await repository.update(createResult.value.id, archived);

      const result = await repository.findByUserId('user-123', { archived: true });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.archived).toBe(true);
      }
    });

    it('filters by archived: false', async () => {
      await repository.create(createTestInput());

      const result = await repository.findByUserId('user-123', { archived: false });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.archived).toBe(false);
      }
    });

    it('filters by ogFetchStatus pending', async () => {
      await repository.create(createTestInput());

      const result = await repository.findByUserId('user-123', { ogFetchStatus: 'pending' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.ogFetchStatus).toBe('pending');
      }
    });

    it('filters by ogFetchStatus processed', async () => {
      const createResult = await repository.create(createTestInput());
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const processed = createFullBookmark(createResult.value.id, {
        ...createResult.value,
        ogFetchStatus: 'processed',
      });
      await repository.update(createResult.value.id, processed);

      const result = await repository.findByUserId('user-123', { ogFetchStatus: 'processed' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.ogFetchStatus).toBe('processed');
      }
    });

    it('filters by ogFetchStatus failed', async () => {
      const createResult = await repository.create(createTestInput());
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const failed = createFullBookmark(createResult.value.id, {
        ...createResult.value,
        ogFetchStatus: 'failed',
      });
      await repository.update(createResult.value.id, failed);

      const result = await repository.findByUserId('user-123', { ogFetchStatus: 'failed' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.ogFetchStatus).toBe('failed');
      }
    });

    it('filters by single tag', async () => {
      await repository.create(createTestInput({ tags: ['work'], url: 'https://a.com' }));
      await repository.create(createTestInput({ tags: ['personal'], url: 'https://b.com' }));

      const result = await repository.findByUserId('user-123', { tags: ['work'] });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.tags).toContain('work');
      }
    });

    it('filters by multiple tags (OR logic)', async () => {
      await repository.create(createTestInput({ tags: ['work'], url: 'https://a.com' }));
      await repository.create(createTestInput({ tags: ['personal'], url: 'https://b.com' }));
      await repository.create(createTestInput({ tags: ['other'], url: 'https://c.com' }));

      const result = await repository.findByUserId('user-123', { tags: ['work', 'personal'] });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
      }
    });

    it('combines multiple filters', async () => {
      const createResult = await repository.create(
        createTestInput({ tags: ['work'], url: 'https://a.com' })
      );
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const archived = createFullBookmark(createResult.value.id, {
        ...createResult.value,
        archived: true,
        tags: ['work'],
      });
      await repository.update(createResult.value.id, archived);

      await repository.create(createTestInput({ tags: ['work'], url: 'https://b.com' }));

      const result = await repository.findByUserId('user-123', {
        archived: true,
        tags: ['work'],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.archived).toBe(true);
        expect(result.value[0]?.tags).toContain('work');
      }
    });

    it('returns empty when filter has no matches', async () => {
      await repository.create(createTestInput({ tags: ['work'] }));

      const result = await repository.findByUserId('user-123', { tags: ['nonexistent'] });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(0);
      }
    });
  });

  describe('findByUserIdAndUrl', () => {
    it('returns null when URL does not exist', async () => {
      const result = await repository.findByUserIdAndUrl('user-123', 'https://nonexistent.com');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns bookmark when URL matches for user', async () => {
      const createResult = await repository.create(
        createTestInput({ url: 'https://example.com/find-me' })
      );
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const result = await repository.findByUserIdAndUrl('user-123', 'https://example.com/find-me');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toBeNull();
        expect(result.value?.url).toBe('https://example.com/find-me');
        expect(result.value?.id).toBe(createResult.value.id);
      }
    });

    it('returns null when URL exists but for different user', async () => {
      await repository.create(
        createTestInput({ userId: 'user-A', url: 'https://example.com/shared' })
      );

      const result = await repository.findByUserIdAndUrl('user-B', 'https://example.com/shared');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns correct bookmark when multiple users have different URLs', async () => {
      await repository.create(createTestInput({ userId: 'user-A', url: 'https://a.com' }));
      await repository.create(createTestInput({ userId: 'user-B', url: 'https://b.com' }));

      const resultA = await repository.findByUserIdAndUrl('user-A', 'https://a.com');
      const resultB = await repository.findByUserIdAndUrl('user-B', 'https://b.com');

      expect(resultA.ok).toBe(true);
      expect(resultB.ok).toBe(true);
      if (resultA.ok && resultB.ok) {
        expect(resultA.value?.userId).toBe('user-A');
        expect(resultB.value?.userId).toBe('user-B');
      }
    });
  });

  describe('update', () => {
    it('returns NOT_FOUND error for non-existent bookmark', async () => {
      const fakeBookmark = createFullBookmark('nonexistent-id');

      const result = await repository.update('nonexistent-id', fakeBookmark);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
        expect(result.error.message).toBe('Bookmark not found');
      }
    });

    it('updates bookmark successfully', async () => {
      const createResult = await repository.create(createTestInput());
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const updatedBookmark = createFullBookmark(createResult.value.id, {
        ...createResult.value,
        title: 'Updated Title',
        tags: ['updated'],
        updatedAt: new Date(),
      });

      const result = await repository.update(createResult.value.id, updatedBookmark);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Updated Title');
        expect(result.value.tags).toEqual(['updated']);
      }
    });

    it('preserves all fields including dates', async () => {
      const createResult = await repository.create(createTestInput());
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const ogFetchedAt = new Date('2025-01-15T10:00:00Z');
      const aiSummarizedAt = new Date('2025-01-15T11:00:00Z');
      const ogPreview: OpenGraphPreview = {
        title: 'OG Title',
        description: 'OG Description',
        image: 'https://example.com/image.png',
        siteName: 'Example',
        type: 'article',
        favicon: 'https://example.com/favicon.ico',
      };

      const updatedBookmark = createFullBookmark(createResult.value.id, {
        ...createResult.value,
        ogPreview,
        ogFetchedAt,
        ogFetchStatus: 'processed',
        aiSummary: 'AI generated summary',
        aiSummarizedAt,
        updatedAt: new Date(),
      });

      const result = await repository.update(createResult.value.id, updatedBookmark);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.ogPreview).toEqual(ogPreview);
        expect(result.value.ogFetchedAt?.toISOString()).toBe(ogFetchedAt.toISOString());
        expect(result.value.ogFetchStatus).toBe('processed');
        expect(result.value.aiSummary).toBe('AI generated summary');
        expect(result.value.aiSummarizedAt?.toISOString()).toBe(aiSummarizedAt.toISOString());
      }

      const findResult = await repository.findById(createResult.value.id);
      expect(findResult.ok).toBe(true);
      if (findResult.ok && findResult.value) {
        expect(findResult.value.ogFetchedAt).toBeInstanceOf(Date);
        expect(findResult.value.aiSummarizedAt).toBeInstanceOf(Date);
      }
    });

    it('updates archived status', async () => {
      const createResult = await repository.create(createTestInput());
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const archivedBookmark = createFullBookmark(createResult.value.id, {
        ...createResult.value,
        archived: true,
        updatedAt: new Date(),
      });

      const result = await repository.update(createResult.value.id, archivedBookmark);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.archived).toBe(true);
      }
    });
  });

  describe('delete', () => {
    it('returns NOT_FOUND error for non-existent bookmark', async () => {
      const result = await repository.delete('nonexistent-id');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
        expect(result.error.message).toBe('Bookmark not found');
      }
    });

    it('deletes existing bookmark', async () => {
      const createResult = await repository.create(createTestInput());
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const deleteResult = await repository.delete(createResult.value.id);

      expect(deleteResult.ok).toBe(true);

      const findResult = await repository.findById(createResult.value.id);
      expect(findResult.ok).toBe(true);
      if (findResult.ok) {
        expect(findResult.value).toBeNull();
      }
    });

    it('does not affect other bookmarks when deleting', async () => {
      const result1 = await repository.create(
        createTestInput({ title: 'Bookmark 1', url: 'https://a.com' })
      );
      const result2 = await repository.create(
        createTestInput({ title: 'Bookmark 2', url: 'https://b.com' })
      );
      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (!result1.ok || !result2.ok) return;

      await repository.delete(result1.value.id);

      const findResult = await repository.findById(result2.value.id);
      expect(findResult.ok).toBe(true);
      if (findResult.ok) {
        expect(findResult.value).not.toBeNull();
        expect(findResult.value?.title).toBe('Bookmark 2');
      }
    });
  });

  describe('error handling', () => {
    it('returns STORAGE_ERROR when create fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Connection failed') });
      const result = await repository.create(createTestInput());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('STORAGE_ERROR');
        expect(result.error.message).toContain('Connection failed');
      }
    });

    it('returns STORAGE_ERROR when findById fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Read failed') });
      const result = await repository.findById('some-id');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('STORAGE_ERROR');
        expect(result.error.message).toContain('Read failed');
      }
    });

    it('returns STORAGE_ERROR when findByUserId fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Query failed') });
      const result = await repository.findByUserId('user-123');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('STORAGE_ERROR');
        expect(result.error.message).toContain('Query failed');
      }
    });

    it('returns STORAGE_ERROR when findByUserIdAndUrl fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('URL lookup failed') });
      const result = await repository.findByUserIdAndUrl('user-123', 'https://example.com');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('STORAGE_ERROR');
        expect(result.error.message).toContain('URL lookup failed');
      }
    });

    it('returns STORAGE_ERROR when update fails due to Firestore error', async () => {
      const createResult = await repository.create(createTestInput());
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      fakeFirestore.configure({ errorToThrow: new Error('Update failed') });

      const updatedBookmark = createFullBookmark(createResult.value.id, {
        ...createResult.value,
        title: 'Updated',
        updatedAt: new Date(),
      });
      const result = await repository.update(createResult.value.id, updatedBookmark);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('STORAGE_ERROR');
        expect(result.error.message).toContain('Update failed');
      }
    });

    it('returns STORAGE_ERROR when delete fails due to Firestore error', async () => {
      const createResult = await repository.create(createTestInput());
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      fakeFirestore.configure({ errorToThrow: new Error('Delete failed') });
      const result = await repository.delete(createResult.value.id);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('STORAGE_ERROR');
        expect(result.error.message).toContain('Delete failed');
      }
    });
  });
});
