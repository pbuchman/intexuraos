import type { Result } from '@intexuraos/common-core';
import type { Bookmark, BookmarkError } from '../models/bookmark.js';
import type { BookmarkRepository } from '../ports/bookmarkRepository.js';

interface MinimalLogger {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
}

export interface UnarchiveBookmarkDeps {
  bookmarkRepository: BookmarkRepository;
  logger: MinimalLogger;
}

export async function unarchiveBookmark(
  deps: UnarchiveBookmarkDeps,
  bookmarkId: string,
  userId: string
): Promise<Result<Bookmark, BookmarkError | { code: 'FORBIDDEN'; message: string }>> {
  deps.logger.info({ bookmarkId, userId }, 'Unarchiving bookmark');

  const findResult = await deps.bookmarkRepository.findById(bookmarkId);

  if (!findResult.ok) {
    return findResult;
  }

  if (findResult.value === null) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Bookmark not found' } };
  }

  if (findResult.value.userId !== userId) {
    deps.logger.warn(
      { bookmarkId, userId, ownerId: findResult.value.userId },
      'Access denied to bookmark'
    );
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Access denied' } };
  }

  const bookmark = findResult.value;

  if (!bookmark.archived) {
    return { ok: true, value: bookmark };
  }

  const updatedBookmark: Bookmark = {
    ...bookmark,
    archived: false,
    updatedAt: new Date(),
  };

  const result = await deps.bookmarkRepository.update(bookmarkId, updatedBookmark);

  if (result.ok) {
    deps.logger.info({ bookmarkId }, 'Bookmark unarchived');
  }

  return result;
}
