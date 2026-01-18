import { describe, it, expect, beforeEach } from 'vitest';
import pino from 'pino';
import { FakeBookmarkRepository } from './fakeBookmarkRepository.js';
import { FakeBookmarkSummaryService } from './fakeBookmarkSummaryService.js';
import { summarizeBookmark } from '../domain/usecases/summarizeBookmark.js';

const silentLogger = pino({ level: 'silent' });

describe('summarizeBookmark', () => {
  let bookmarkRepository: FakeBookmarkRepository;
  let bookmarkSummaryService: FakeBookmarkSummaryService;

  beforeEach(() => {
    bookmarkRepository = new FakeBookmarkRepository();
    bookmarkSummaryService = new FakeBookmarkSummaryService();
  });

  it('generates summary and updates bookmark', async () => {
    const createResult = await bookmarkRepository.create({
      userId: 'user-1',
      url: 'https://example.com/page',
      source: 'test',
      sourceId: 'test-1',
      title: 'Example Page',
      description: 'A description of the page',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const bookmarkId = createResult.value.id;

    bookmarkSummaryService.setDefaultSummary(
      'This page is about example content and provides useful information.'
    );

    const result = await summarizeBookmark(
      { bookmarkRepository, bookmarkSummaryService, logger: silentLogger },
      { bookmarkId, userId: 'user-1' }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.aiSummary).toBe(
      'This page is about example content and provides useful information.'
    );
    expect(result.value.aiSummarizedAt).not.toBeNull();
    expect(bookmarkSummaryService.generateSummaryCalls).toHaveLength(1);
    expect(bookmarkSummaryService.generateSummaryCalls[0]).toEqual({
      userId: 'user-1',
      content: {
        url: 'https://example.com/page',
        title: 'Example Page',
        description: 'A description of the page',
      },
    });
  });

  it('uses ogPreview title and description when available', async () => {
    const createResult = await bookmarkRepository.create({
      userId: 'user-1',
      url: 'https://example.com/page',
      source: 'test',
      sourceId: 'test-1',
      title: 'Original Title',
      description: 'Original Description',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const bookmark = createResult.value;
    bookmark.ogPreview = {
      title: 'OG Title',
      description: 'OG Description',
      image: null,
      siteName: null,
      type: null,
      favicon: null,
    };
    await bookmarkRepository.update(bookmark.id, bookmark);

    const result = await summarizeBookmark(
      { bookmarkRepository, bookmarkSummaryService, logger: silentLogger },
      { bookmarkId: bookmark.id, userId: 'user-1' }
    );

    expect(result.ok).toBe(true);
    expect(bookmarkSummaryService.generateSummaryCalls[0]?.content).toEqual({
      url: 'https://example.com/page',
      title: 'OG Title',
      description: 'OG Description',
    });
  });

  it('returns NOT_FOUND for non-existent bookmark', async () => {
    const result = await summarizeBookmark(
      { bookmarkRepository, bookmarkSummaryService, logger: silentLogger },
      { bookmarkId: 'non-existent', userId: 'user-1' }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  });

  it('returns NOT_FOUND for wrong userId', async () => {
    const createResult = await bookmarkRepository.create({
      userId: 'user-1',
      url: 'https://example.com',
      source: 'test',
      sourceId: 'test-1',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const result = await summarizeBookmark(
      { bookmarkRepository, bookmarkSummaryService, logger: silentLogger },
      { bookmarkId: createResult.value.id, userId: 'wrong-user' }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  });

  it('skips bookmarks that already have a summary', async () => {
    const createResult = await bookmarkRepository.create({
      userId: 'user-1',
      url: 'https://example.com',
      source: 'test',
      sourceId: 'test-1',
      title: 'Test Page',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const bookmark = createResult.value;
    bookmark.aiSummary = 'Existing summary';
    bookmark.aiSummarizedAt = new Date();
    await bookmarkRepository.update(bookmark.id, bookmark);

    const result = await summarizeBookmark(
      { bookmarkRepository, bookmarkSummaryService, logger: silentLogger },
      { bookmarkId: bookmark.id, userId: 'user-1' }
    );

    expect(result.ok).toBe(true);
    expect(bookmarkSummaryService.generateSummaryCalls).toHaveLength(0);
  });

  it('returns success without generating summary when no content available', async () => {
    const createResult = await bookmarkRepository.create({
      userId: 'user-1',
      url: 'https://example.com',
      source: 'test',
      sourceId: 'test-1',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const result = await summarizeBookmark(
      { bookmarkRepository, bookmarkSummaryService, logger: silentLogger },
      { bookmarkId: createResult.value.id, userId: 'user-1' }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.aiSummary).toBeNull();
    expect(bookmarkSummaryService.generateSummaryCalls).toHaveLength(0);
  });

  it('returns success without updating when summary generation fails', async () => {
    const createResult = await bookmarkRepository.create({
      userId: 'user-1',
      url: 'https://example.com',
      source: 'test',
      sourceId: 'test-1',
      title: 'Test Page',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    bookmarkSummaryService.setNextError({
      code: 'NO_API_KEY',
      message: 'No API key configured',
    });

    const result = await summarizeBookmark(
      { bookmarkRepository, bookmarkSummaryService, logger: silentLogger },
      { bookmarkId: createResult.value.id, userId: 'user-1' }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.aiSummary).toBeNull();
  });

  it('returns error when findById fails', async () => {
    bookmarkRepository.simulateMethodError('findById', {
      code: 'STORAGE_ERROR',
      message: 'Database connection failed',
    });

    const result = await summarizeBookmark(
      { bookmarkRepository, bookmarkSummaryService, logger: silentLogger },
      { bookmarkId: 'any-id', userId: 'user-1' }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('STORAGE_ERROR');
    expect(result.error.message).toBe('Database connection failed');
  });
});
