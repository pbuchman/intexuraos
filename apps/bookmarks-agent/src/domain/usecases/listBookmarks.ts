import type { Result } from '@intexuraos/common-core';
import type { Bookmark, BookmarkFilters, BookmarkError } from '../models/bookmark.js';
import type { BookmarkRepository } from '../ports/bookmarkRepository.js';

interface MinimalLogger {
  info: (obj: object, msg?: string) => void;
}

export interface ListBookmarksDeps {
  bookmarkRepository: BookmarkRepository;
  logger: MinimalLogger;
}

export async function listBookmarks(
  deps: ListBookmarksDeps,
  userId: string,
  filters?: BookmarkFilters
): Promise<Result<Bookmark[], BookmarkError>> {
  deps.logger.info({ userId, filters }, 'Listing bookmarks');

  return await deps.bookmarkRepository.findByUserId(userId, filters);
}
