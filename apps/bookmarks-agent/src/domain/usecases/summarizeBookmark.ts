import type { Result } from '@intexuraos/common-core';
import { err } from '@intexuraos/common-core';
import type { Bookmark, BookmarkError } from '../models/bookmark.js';
import type { BookmarkRepository } from '../ports/bookmarkRepository.js';
import type { BookmarkSummaryService } from '../ports/bookmarkSummaryService.js';
import { updateBookmarkInternal } from './updateBookmarkInternal.js';

interface MinimalLogger {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
}

export interface SummarizeBookmarkDeps {
  bookmarkRepository: BookmarkRepository;
  bookmarkSummaryService: BookmarkSummaryService;
  logger: MinimalLogger;
}

export interface SummarizeBookmarkInput {
  bookmarkId: string;
  userId: string;
}

export async function summarizeBookmark(
  deps: SummarizeBookmarkDeps,
  input: SummarizeBookmarkInput
): Promise<Result<Bookmark, BookmarkError>> {
  const { bookmarkId, userId } = input;

  deps.logger.info({ bookmarkId, userId }, 'Starting bookmark summarization');

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

  if (bookmark.aiSummary !== null) {
    deps.logger.info({ bookmarkId }, 'Bookmark already has summary, skipping');
    return { ok: true, value: bookmark };
  }

  const title = bookmark.ogPreview?.title ?? bookmark.title;
  const description = bookmark.ogPreview?.description ?? bookmark.description;

  if (title === null && description === null) {
    deps.logger.warn(
      { bookmarkId },
      'No content available for summarization (no title or description)'
    );
    return { ok: true, value: bookmark };
  }

  const summaryResult = await deps.bookmarkSummaryService.generateSummary(userId, {
    url: bookmark.url,
    title,
    description,
  });

  if (!summaryResult.ok) {
    deps.logger.warn(
      { bookmarkId, error: summaryResult.error },
      'Failed to generate bookmark summary'
    );
    return { ok: true, value: bookmark };
  }

  deps.logger.info({ bookmarkId }, 'Bookmark summary generated successfully');

  return await updateBookmarkInternal(
    { bookmarkRepository: deps.bookmarkRepository, logger: deps.logger },
    bookmarkId,
    { aiSummary: summaryResult.value }
  );
}
