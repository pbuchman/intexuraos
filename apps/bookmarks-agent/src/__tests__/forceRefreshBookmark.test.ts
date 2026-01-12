import { describe, it, expect, beforeEach } from 'vitest';
import pino from 'pino';
import { FakeBookmarkRepository } from './fakeBookmarkRepository.js';
import { FakeLinkPreviewFetcher } from './fakeLinkPreviewFetcher.js';
import { forceRefreshBookmark } from '../domain/usecases/forceRefreshBookmark.js';

const silentLogger = pino({ level: 'silent' });

describe('forceRefreshBookmark', () => {
  let bookmarkRepository: FakeBookmarkRepository;
  let linkPreviewFetcher: FakeLinkPreviewFetcher;

  beforeEach(() => {
    bookmarkRepository = new FakeBookmarkRepository();
    linkPreviewFetcher = new FakeLinkPreviewFetcher();
  });

  it('returns NOT_FOUND error when bookmark does not exist', async () => {
    const result = await forceRefreshBookmark(
      { bookmarkRepository, linkPreviewFetcher, logger: silentLogger },
      'non-existent-id'
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });

  it('returns error when repository returns error', async () => {
    bookmarkRepository.simulateMethodError('findById', {
      code: 'STORAGE_ERROR',
      message: 'Database error',
    });

    const result = await forceRefreshBookmark(
      { bookmarkRepository, linkPreviewFetcher, logger: silentLogger },
      'bookmark-123'
    );

    expect(result.ok).toBe(false);
  });

  it('updates bookmark with fetched OG data on success', async () => {
    const createResult = await bookmarkRepository.create({
      userId: 'user-1',
      url: 'https://example.com/article',
      source: 'test',
      sourceId: 'test-1',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const bookmarkId = createResult.value.id;

    linkPreviewFetcher.setDefaultPreview({
      title: 'Test Title',
      description: 'Test Description',
      image: 'https://example.com/image.jpg',
      siteName: 'Example Site',
      type: null,
      favicon: 'https://example.com/favicon.ico',
    });

    const result = await forceRefreshBookmark(
      { bookmarkRepository, linkPreviewFetcher, logger: silentLogger },
      bookmarkId
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ogPreview).toEqual({
        title: 'Test Title',
        description: 'Test Description',
        image: 'https://example.com/image.jpg',
        siteName: 'Example Site',
        favicon: 'https://example.com/favicon.ico',
        type: null,
      });
      expect(result.value.ogFetchStatus).toBe('processed');
    }
    expect(linkPreviewFetcher.fetchPreviewCalls).toEqual(['https://example.com/article']);
  });

  it('updates bookmark with failed status when fetchPreview fails', async () => {
    const createResult = await bookmarkRepository.create({
      userId: 'user-1',
      url: 'https://example.com/article',
      source: 'test',
      sourceId: 'test-1',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const bookmarkId = createResult.value.id;

    linkPreviewFetcher.setNextResult({
      ok: false,
      error: { code: 'FETCH_FAILED', message: 'Network error' },
    });

    const result = await forceRefreshBookmark(
      { bookmarkRepository, linkPreviewFetcher, logger: silentLogger },
      bookmarkId
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ogFetchStatus).toBe('failed');
    }
  });

  it('handles partial preview data correctly', async () => {
    const createResult = await bookmarkRepository.create({
      userId: 'user-1',
      url: 'https://example.com/minimal',
      source: 'test',
      sourceId: 'test-1',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const bookmarkId = createResult.value.id;

    linkPreviewFetcher.setDefaultPreview({
      title: null,
      description: null,
      image: null,
      siteName: null,
      type: null,
      favicon: null,
    });

    const result = await forceRefreshBookmark(
      { bookmarkRepository, linkPreviewFetcher, logger: silentLogger },
      bookmarkId
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ogPreview).toEqual({
        title: null,
        description: null,
        image: null,
        siteName: null,
        favicon: null,
        type: null,
      });
    }
  });
});
