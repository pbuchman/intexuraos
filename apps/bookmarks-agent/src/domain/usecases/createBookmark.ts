import type { Result } from '@intexuraos/common-core';
import type { Bookmark, CreateBookmarkInput, BookmarkError } from '../models/bookmark.js';
import type { BookmarkRepository } from '../ports/bookmarkRepository.js';

interface MinimalLogger {
  info: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
}

export interface CreateBookmarkDeps {
  bookmarkRepository: BookmarkRepository;
  logger: MinimalLogger;
}

export async function createBookmark(
  deps: CreateBookmarkDeps,
  input: CreateBookmarkInput
): Promise<Result<Bookmark, BookmarkError>> {
  deps.logger.info(
    { userId: input.userId, source: input.source, url: input.url },
    'Creating bookmark'
  );

  const existingResult = await deps.bookmarkRepository.findByUserIdAndUrl(input.userId, input.url);

  if (!existingResult.ok) {
    return existingResult;
  }

  if (existingResult.value !== null) {
    deps.logger.info({ userId: input.userId, url: input.url }, 'Duplicate bookmark URL');
    return {
      ok: false,
      error: { code: 'DUPLICATE_URL', message: 'Bookmark with this URL already exists' },
    };
  }

  const result = await deps.bookmarkRepository.create(input);

  if (result.ok) {
    deps.logger.info({ bookmarkId: result.value.id }, 'Bookmark created');
  } else {
    deps.logger.error({ error: result.error }, 'Failed to create bookmark');
  }

  return result;
}
