import type { Result } from '@intexuraos/common-core';
import { getErrorMessage } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type {
  Bookmark,
  CreateBookmarkInput,
  BookmarkFilters,
  BookmarkError,
  OgFetchStatus,
} from '../../domain/models/bookmark.js';
import type { BookmarkRepository } from '../../domain/ports/bookmarkRepository.js';

const COLLECTION = 'bookmarks';

interface OpenGraphPreviewDocument {
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  type: string | null;
  favicon: string | null;
}

interface BookmarkDocument {
  userId: string;
  status: string;
  url: string;
  title: string | null;
  description: string | null;
  tags: string[];
  ogPreview: OpenGraphPreviewDocument | null;
  ogFetchedAt: string | null;
  ogFetchStatus: OgFetchStatus;
  aiSummary: string | null;
  aiSummarizedAt: string | null;
  source: string;
  sourceId: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

function toBookmark(id: string, doc: BookmarkDocument): Bookmark {
  return {
    id,
    userId: doc.userId,
    status: (doc.status || 'active') as Bookmark['status'],
    url: doc.url,
    title: doc.title,
    description: doc.description,
    tags: doc.tags,
    ogPreview: doc.ogPreview,
    ogFetchedAt: doc.ogFetchedAt !== null ? new Date(doc.ogFetchedAt) : null,
    ogFetchStatus: doc.ogFetchStatus,
    aiSummary: doc.aiSummary,
    aiSummarizedAt: doc.aiSummarizedAt !== null ? new Date(doc.aiSummarizedAt) : null,
    source: doc.source,
    sourceId: doc.sourceId,
    archived: doc.archived,
    createdAt: new Date(doc.createdAt),
    updatedAt: new Date(doc.updatedAt),
  };
}

function toBookmarkDocument(bookmark: Bookmark): BookmarkDocument {
  return {
    userId: bookmark.userId,
    status: bookmark.status,
    url: bookmark.url,
    title: bookmark.title,
    description: bookmark.description,
    tags: bookmark.tags,
    ogPreview: bookmark.ogPreview,
    ogFetchedAt: bookmark.ogFetchedAt !== null ? bookmark.ogFetchedAt.toISOString() : null,
    ogFetchStatus: bookmark.ogFetchStatus,
    aiSummary: bookmark.aiSummary,
    aiSummarizedAt: bookmark.aiSummarizedAt !== null ? bookmark.aiSummarizedAt.toISOString() : null,
    source: bookmark.source,
    sourceId: bookmark.sourceId,
    archived: bookmark.archived,
    createdAt: bookmark.createdAt.toISOString(),
    updatedAt: bookmark.updatedAt.toISOString(),
  };
}

export class FirestoreBookmarkRepository implements BookmarkRepository {
  async create(input: CreateBookmarkInput): Promise<Result<Bookmark, BookmarkError>> {
    try {
      const db = getFirestore();
      const now = new Date();
      const docRef = db.collection(COLLECTION).doc();

      const bookmark: Bookmark = {
        id: docRef.id,
        userId: input.userId,
        status: input.status ?? 'active',
        url: input.url,
        title: input.title ?? null,
        description: input.description ?? null,
        tags: input.tags ?? [],
        ogPreview: null,
        ogFetchedAt: null,
        ogFetchStatus: 'pending',
        aiSummary: null,
        aiSummarizedAt: null,
        source: input.source,
        sourceId: input.sourceId,
        archived: false,
        createdAt: now,
        updatedAt: now,
      };

      await docRef.set(toBookmarkDocument(bookmark));

      return { ok: true, value: bookmark };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'STORAGE_ERROR',
          message: getErrorMessage(error, 'Failed to create bookmark'),
        },
      };
    }
  }

  async findById(id: string): Promise<Result<Bookmark | null, BookmarkError>> {
    try {
      const db = getFirestore();
      const doc = await db.collection(COLLECTION).doc(id).get();

      if (!doc.exists) {
        return { ok: true, value: null };
      }

      return { ok: true, value: toBookmark(doc.id, doc.data() as BookmarkDocument) };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'STORAGE_ERROR',
          message: getErrorMessage(error, 'Failed to find bookmark'),
        },
      };
    }
  }

  async findByUserId(
    userId: string,
    filters?: BookmarkFilters
  ): Promise<Result<Bookmark[], BookmarkError>> {
    try {
      const db = getFirestore();
      let query = db.collection(COLLECTION).where('userId', '==', userId);

      if (filters?.archived !== undefined) {
        query = query.where('archived', '==', filters.archived);
      }

      if (filters?.ogFetchStatus !== undefined) {
        query = query.where('ogFetchStatus', '==', filters.ogFetchStatus);
      }

      query = query.orderBy('createdAt', 'desc');

      const snapshot = await query.get();
      let bookmarks = snapshot.docs.map((doc) =>
        toBookmark(doc.id, doc.data() as BookmarkDocument)
      );

      if (filters?.tags !== undefined && filters.tags.length > 0) {
        const filterTags = filters.tags;
        bookmarks = bookmarks.filter((bookmark) =>
          filterTags.some((tag) => bookmark.tags.includes(tag))
        );
      }

      return { ok: true, value: bookmarks };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'STORAGE_ERROR',
          message: getErrorMessage(error, 'Failed to list bookmarks'),
        },
      };
    }
  }

  async findByUserIdAndUrl(
    userId: string,
    url: string
  ): Promise<Result<Bookmark | null, BookmarkError>> {
    try {
      const db = getFirestore();
      const snapshot = await db
        .collection(COLLECTION)
        .where('userId', '==', userId)
        .where('url', '==', url)
        .limit(1)
        .get();

      if (snapshot.empty) {
        return { ok: true, value: null };
      }

      const doc = snapshot.docs[0];
      if (doc === undefined) {
        return { ok: true, value: null };
      }

      return { ok: true, value: toBookmark(doc.id, doc.data() as BookmarkDocument) };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'STORAGE_ERROR',
          message: getErrorMessage(error, 'Failed to find bookmark by URL'),
        },
      };
    }
  }

  async update(id: string, bookmark: Bookmark): Promise<Result<Bookmark, BookmarkError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION).doc(id);
      const doc = await docRef.get();

      if (!doc.exists) {
        return { ok: false, error: { code: 'NOT_FOUND', message: 'Bookmark not found' } };
      }

      await docRef.set(toBookmarkDocument(bookmark));

      return { ok: true, value: bookmark };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'STORAGE_ERROR',
          message: getErrorMessage(error, 'Failed to update bookmark'),
        },
      };
    }
  }

  async delete(id: string): Promise<Result<void, BookmarkError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION).doc(id);
      const doc = await docRef.get();

      if (!doc.exists) {
        return { ok: false, error: { code: 'NOT_FOUND', message: 'Bookmark not found' } };
      }

      await docRef.delete();
      return { ok: true, value: undefined };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'STORAGE_ERROR',
          message: getErrorMessage(error, 'Failed to delete bookmark'),
        },
      };
    }
  }
}
