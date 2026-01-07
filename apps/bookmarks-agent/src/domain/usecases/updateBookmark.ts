import type { Result } from '@intexuraos/common-core';
import type { Bookmark, UpdateBookmarkInput, BookmarkError } from '../models/bookmark.js';
import type { BookmarkRepository } from '../ports/bookmarkRepository.js';

interface MinimalLogger {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
}

export interface UpdateBookmarkDeps {
  bookmarkRepository: BookmarkRepository;
  logger: MinimalLogger;
}

export async function updateBookmark(
  deps: UpdateBookmarkDeps,
  bookmarkId: string,
  userId: string,
  input: UpdateBookmarkInput
): Promise<Result<Bookmark, BookmarkError | { code: 'FORBIDDEN'; message: string }>> {
  deps.logger.info({ bookmarkId, userId }, 'Updating bookmark');

  const findResult = await deps.bookmarkRepository.findById(bookmarkId);

  if (!findResult.ok) {
    return findResult;
  }

  if (findResult.value === null) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Bookmark not found' } };
  }

  if (findResult.value.userId !== userId) {
    deps.logger.warn({ bookmarkId, userId, ownerId: findResult.value.userId }, 'Access denied to bookmark');
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Access denied' } };
  }

  const updatedBookmark: Bookmark = {
    ...findResult.value,
    title: input.title ?? findResult.value.title,
    description: input.description ?? findResult.value.description,
    tags: input.tags ?? findResult.value.tags,
    archived: input.archived ?? findResult.value.archived,
    updatedAt: new Date(),
  };

  const result = await deps.bookmarkRepository.update(bookmarkId, updatedBookmark);

  if (result.ok) {
    deps.logger.info({ bookmarkId }, 'Bookmark updated');
  }

  return result;
}
