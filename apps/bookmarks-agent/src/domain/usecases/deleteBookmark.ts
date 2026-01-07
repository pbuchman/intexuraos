import type { Result } from '@intexuraos/common-core';
import type { BookmarkError } from '../models/bookmark.js';
import type { BookmarkRepository } from '../ports/bookmarkRepository.js';

interface MinimalLogger {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
}

export interface DeleteBookmarkDeps {
  bookmarkRepository: BookmarkRepository;
  logger: MinimalLogger;
}

export async function deleteBookmark(
  deps: DeleteBookmarkDeps,
  bookmarkId: string,
  userId: string
): Promise<Result<void, BookmarkError | { code: 'FORBIDDEN'; message: string }>> {
  deps.logger.info({ bookmarkId, userId }, 'Deleting bookmark');

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

  const result = await deps.bookmarkRepository.delete(bookmarkId);

  if (result.ok) {
    deps.logger.info({ bookmarkId }, 'Bookmark deleted');
  }

  return result;
}
