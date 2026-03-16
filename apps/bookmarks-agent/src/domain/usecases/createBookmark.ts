import type { Result } from '@intexuraos/common-core';
import type { Bookmark, CreateBookmarkInput, BookmarkError } from '../models/bookmark.js';
import type { BookmarkRepository } from '../ports/bookmarkRepository.js';
import type { EnrichPublisher } from '../ports/enrichPublisher.js';

interface MinimalLogger {
  info: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
}

export interface CreateBookmarkDeps {
  bookmarkRepository: BookmarkRepository;
  logger: MinimalLogger;
  enrichPublisher?: EnrichPublisher;
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
      error: {
        code: 'DUPLICATE_URL',
        message: 'Bookmark with this URL already exists',
        existingBookmarkId: existingResult.value.id,
      },
    };
  }

  const result = await deps.bookmarkRepository.create(input);

  if (result.ok) {
    deps.logger.info({ bookmarkId: result.value.id }, 'Bookmark created');

    // Publish enrichment event if enrichPublisher is provided (best-effort, fire-and-forget)
    if (deps.enrichPublisher !== undefined) {
      const bookmarkId = result.value.id;
      deps.enrichPublisher
        .publishEnrichBookmark({
          type: 'bookmarks.enrich',
          bookmarkId,
          userId: input.userId,
          url: input.url,
        })
        .then((publishResult) => {
          if (!publishResult.ok) {
            deps.logger.warn(
              { bookmarkId, error: publishResult.error },
              'Failed to publish enrichment event'
            );
          }
        })
        .catch((error: unknown) => {
          deps.logger.warn({ bookmarkId, error }, 'Failed to publish enrichment event');
        });
    }
  } else {
    deps.logger.error({ error: result.error }, 'Failed to create bookmark');
  }

  return result;
}
