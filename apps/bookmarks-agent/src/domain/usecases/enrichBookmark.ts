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

export interface EnrichBookmarkDeps {
  bookmarkRepository: BookmarkRepository;
  linkPreviewFetcher: LinkPreviewFetcherPort;
  logger: MinimalLogger;
}

export interface EnrichBookmarkInput {
  bookmarkId: string;
  userId: string;
}

export async function enrichBookmark(
  deps: EnrichBookmarkDeps,
  input: EnrichBookmarkInput
): Promise<Result<Bookmark, BookmarkError>> {
  const { bookmarkId, userId } = input;

  deps.logger.info({ bookmarkId, userId }, 'Starting bookmark enrichment');

  const findResult = await deps.bookmarkRepository.findById(bookmarkId);
  if (!findResult.ok) {
    return findResult;
  }

  if (findResult.value === null) {
    return err({ code: 'NOT_FOUND', message: 'Bookmark not found' });
  }

  const bookmark = findResult.value;

  if (bookmark.userId !== userId) {
    return err({ code: 'NOT_FOUND', message: 'Bookmark not found' });
  }

  if (bookmark.ogFetchStatus === 'processed') {
    deps.logger.info({ bookmarkId }, 'Bookmark already enriched, skipping');
    return { ok: true, value: bookmark };
  }

  const previewResult = await deps.linkPreviewFetcher.fetchPreview(bookmark.url);

  if (!previewResult.ok) {
    deps.logger.warn(
      { bookmarkId, error: previewResult.error },
      'Failed to fetch link preview'
    );

    return await updateBookmarkInternal(
      { bookmarkRepository: deps.bookmarkRepository, logger: deps.logger },
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

  deps.logger.info({ bookmarkId }, 'Link preview fetched successfully');

  return await updateBookmarkInternal(
    { bookmarkRepository: deps.bookmarkRepository, logger: deps.logger },
    bookmarkId,
    { ogPreview, ogFetchStatus: 'processed' }
  );
}
