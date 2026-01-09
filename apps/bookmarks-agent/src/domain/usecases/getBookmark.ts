import type { Result } from '@intexuraos/common-core';
import type { Bookmark, BookmarkError } from '../models/bookmark.js';
import type { BookmarkRepository } from '../ports/bookmarkRepository.js';

interface MinimalLogger {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
}

export interface GetBookmarkDeps {
  bookmarkRepository: BookmarkRepository;
  logger: MinimalLogger;
}

export async function getBookmark(
  deps: GetBookmarkDeps,
  bookmarkId: string,
  userId: string
): Promise<Result<Bookmark, BookmarkError | { code: 'FORBIDDEN'; message: string }>> {
  deps.logger.info({ bookmarkId, userId }, 'Getting bookmark');

  const result = await deps.bookmarkRepository.findById(bookmarkId);

  if (!result.ok) {
    return result;
  }

  if (result.value === null) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Bookmark not found' } };
  }

  if (result.value.userId !== userId) {
    deps.logger.warn(
      { bookmarkId, userId, ownerId: result.value.userId },
      'Access denied to bookmark'
    );
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Access denied' } };
  }

  return { ok: true, value: result.value };
}
