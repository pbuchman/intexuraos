import { randomUUID } from 'crypto';
import type { Result } from '@intexuraos/common-core';
import type {
  Bookmark,
  CreateBookmarkInput,
  BookmarkFilters,
  BookmarkError,
} from '../domain/models/bookmark.js';
import type { BookmarkRepository } from '../domain/ports/bookmarkRepository.js';

type MethodName = 'create' | 'findById' | 'findByUserId' | 'findByUserIdAndUrl' | 'update' | 'delete';

export class FakeBookmarkRepository implements BookmarkRepository {
  private bookmarks = new Map<string, Bookmark>();
  private nextError: BookmarkError | null = null;
  private methodErrors = new Map<MethodName, BookmarkError>();

  simulateNextError(error: BookmarkError): void {
    this.nextError = error;
  }

  simulateMethodError(method: MethodName, error: BookmarkError): void {
    this.methodErrors.set(method, error);
  }

  private checkError(method: MethodName): BookmarkError | null {
    const methodError = this.methodErrors.get(method);
    if (methodError !== undefined) {
      this.methodErrors.delete(method);
      return methodError;
    }
    const error = this.nextError;
    this.nextError = null;
    return error;
  }

  create(input: CreateBookmarkInput): Promise<Result<Bookmark, BookmarkError>> {
    const error = this.checkError('create');
    if (error !== null) {
      return Promise.resolve({ ok: false, error });
    }

    const now = new Date();
    const bookmark: Bookmark = {
      id: randomUUID(),
      userId: input.userId,
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

    this.bookmarks.set(bookmark.id, bookmark);
    return Promise.resolve({ ok: true, value: bookmark });
  }

  findById(id: string): Promise<Result<Bookmark | null, BookmarkError>> {
    const error = this.checkError('findById');
    if (error !== null) {
      return Promise.resolve({ ok: false, error });
    }
    const bookmark = this.bookmarks.get(id);
    return Promise.resolve({ ok: true, value: bookmark ?? null });
  }

  findByUserId(userId: string, filters?: BookmarkFilters): Promise<Result<Bookmark[], BookmarkError>> {
    const error = this.checkError('findByUserId');
    if (error !== null) {
      return Promise.resolve({ ok: false, error });
    }

    let userBookmarks = Array.from(this.bookmarks.values()).filter((b) => b.userId === userId);

    if (filters?.archived !== undefined) {
      userBookmarks = userBookmarks.filter((b) => b.archived === filters.archived);
    }

    if (filters?.ogFetchStatus !== undefined) {
      userBookmarks = userBookmarks.filter((b) => b.ogFetchStatus === filters.ogFetchStatus);
    }

    if (filters?.tags !== undefined && filters.tags.length > 0) {
      const filterTags = filters.tags;
      userBookmarks = userBookmarks.filter((b) => filterTags.some((tag) => b.tags.includes(tag)));
    }

    userBookmarks.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return Promise.resolve({ ok: true, value: userBookmarks });
  }

  findByUserIdAndUrl(userId: string, url: string): Promise<Result<Bookmark | null, BookmarkError>> {
    const error = this.checkError('findByUserIdAndUrl');
    if (error !== null) {
      return Promise.resolve({ ok: false, error });
    }

    const bookmark = Array.from(this.bookmarks.values()).find(
      (b) => b.userId === userId && b.url === url
    );
    return Promise.resolve({ ok: true, value: bookmark ?? null });
  }

  update(id: string, bookmark: Bookmark): Promise<Result<Bookmark, BookmarkError>> {
    const error = this.checkError('update');
    if (error !== null) {
      return Promise.resolve({ ok: false, error });
    }

    if (!this.bookmarks.has(id)) {
      return Promise.resolve({
        ok: false,
        error: { code: 'NOT_FOUND', message: 'Bookmark not found' },
      });
    }

    this.bookmarks.set(id, bookmark);
    return Promise.resolve({ ok: true, value: bookmark });
  }

  delete(id: string): Promise<Result<void, BookmarkError>> {
    const error = this.checkError('delete');
    if (error !== null) {
      return Promise.resolve({ ok: false, error });
    }

    if (!this.bookmarks.has(id)) {
      return Promise.resolve({
        ok: false,
        error: { code: 'NOT_FOUND', message: 'Bookmark not found' },
      });
    }

    this.bookmarks.delete(id);
    return Promise.resolve({ ok: true, value: undefined });
  }

  clear(): void {
    this.bookmarks.clear();
  }

  getAll(): Bookmark[] {
    return Array.from(this.bookmarks.values());
  }
}
