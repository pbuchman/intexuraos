import type { Result } from '@intexuraos/common-core';
import { err } from '@intexuraos/common-core';
import type { Bookmark, BookmarkError, OpenGraphPreview } from '../models/bookmark.js';
import type { BookmarkRepository } from '../ports/bookmarkRepository.js';
import type { LinkPreviewFetcherPort } from '../ports/linkPreviewFetcher.js';
import { updateBookmarkInternal } from './updateBookmarkInternal.js';

interface MinimalLogger {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
}

export interface ForceRefreshBookmarkDeps {
  bookmarkRepository: BookmarkRepository;
  linkPreviewFetcher: LinkPreviewFetcherPort;
  logger: MinimalLogger;
}

export async function forceRefreshBookmark(
  deps: ForceRefreshBookmarkDeps,
  bookmarkId: string
): Promise<Result<Bookmark, BookmarkError>> {
  const { bookmarkRepository, linkPreviewFetcher, logger } = deps;

  logger.info({ bookmarkId }, 'Force refreshing bookmark OG data');

  const findResult = await bookmarkRepository.findById(bookmarkId);
  if (!findResult.ok) {
    return findResult;
  }

  if (findResult.value === null) {
    return err({ code: 'NOT_FOUND', message: 'Bookmark not found' });
  }

  const bookmark = findResult.value;

  // Always fetch fresh OG data (no skip if already processed)
  const previewResult = await linkPreviewFetcher.fetchPreview(bookmark.url);

  if (!previewResult.ok) {
    logger.warn(
      { bookmarkId, error: previewResult.error },
      'Failed to fetch link preview during force refresh'
    );

    return await updateBookmarkInternal(
      { bookmarkRepository, logger },
      bookmarkId,
      { ogFetchStatus: 'failed' }
    );
  }

  const ogPreview: OpenGraphPreview = {
    title: previewResult.value.title ?? null,
    description: previewResult.value.description ?? null,
    image: previewResult.value.image ?? null,
    siteName: previewResult.value.siteName ?? null,
    type: null,
    favicon: previewResult.value.favicon ?? null,
  };

  logger.info({ bookmarkId }, 'Force refresh complete - OG data updated');

  return await updateBookmarkInternal(
    { bookmarkRepository, logger },
    bookmarkId,
    { ogPreview, ogFetchStatus: 'processed' }
  );
}
