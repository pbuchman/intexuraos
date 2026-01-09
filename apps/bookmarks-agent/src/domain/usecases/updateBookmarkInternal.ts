import type { Result } from '@intexuraos/common-core';
import type { Bookmark, UpdateBookmarkInternalInput, BookmarkError } from '../models/bookmark.js';
import type { BookmarkRepository } from '../ports/bookmarkRepository.js';

interface MinimalLogger {
  info: (obj: object, msg?: string) => void;
}

export interface UpdateBookmarkInternalDeps {
  bookmarkRepository: BookmarkRepository;
  logger: MinimalLogger;
}

export async function updateBookmarkInternal(
  deps: UpdateBookmarkInternalDeps,
  bookmarkId: string,
  input: UpdateBookmarkInternalInput
): Promise<Result<Bookmark, BookmarkError>> {
  deps.logger.info({ bookmarkId }, 'Updating bookmark (internal)');

  const findResult = await deps.bookmarkRepository.findById(bookmarkId);

  if (!findResult.ok) {
    return findResult;
  }

  if (findResult.value === null) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Bookmark not found' } };
  }

  const now = new Date();
  const updatedBookmark: Bookmark = {
    ...findResult.value,
    title: input.title ?? findResult.value.title,
    description: input.description ?? findResult.value.description,
    tags: input.tags ?? findResult.value.tags,
    archived: input.archived ?? findResult.value.archived,
    ogPreview: input.ogPreview ?? findResult.value.ogPreview,
    ogFetchStatus: input.ogFetchStatus ?? findResult.value.ogFetchStatus,
    ogFetchedAt: input.ogPreview !== undefined ? now : findResult.value.ogFetchedAt,
    aiSummary: input.aiSummary ?? findResult.value.aiSummary,
    aiSummarizedAt: input.aiSummary !== undefined ? now : findResult.value.aiSummarizedAt,
    updatedAt: now,
  };

  const result = await deps.bookmarkRepository.update(bookmarkId, updatedBookmark);

  if (result.ok) {
    deps.logger.info({ bookmarkId }, 'Bookmark updated (internal)');
  }

  return result;
}
