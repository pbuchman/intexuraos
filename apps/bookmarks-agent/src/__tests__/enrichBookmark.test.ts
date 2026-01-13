import { describe, it, expect, beforeEach } from 'vitest';
import pino from 'pino';
import { FakeBookmarkRepository } from './fakeBookmarkRepository.js';
import { FakeLinkPreviewFetcher } from './fakeLinkPreviewFetcher.js';
import { enrichBookmark } from '../domain/usecases/enrichBookmark.js';

const silentLogger = pino({ level: 'silent' });

describe('enrichBookmark', () => {
  let bookmarkRepository: FakeBookmarkRepository;
  let linkPreviewFetcher: FakeLinkPreviewFetcher;

  beforeEach(() => {
    bookmarkRepository = new FakeBookmarkRepository();
    linkPreviewFetcher = new FakeLinkPreviewFetcher();
  });

  it('fetches preview and updates bookmark', async () => {
    const createResult = await bookmarkRepository.create({
      userId: 'user-1',
      url: 'https://example.com/page',
      source: 'test',
      sourceId: 'test-1',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const bookmarkId = createResult.value.id;

    linkPreviewFetcher.setDefaultPreview({
      title: 'Example Page',
      description: 'A great example',
      image: 'https://example.com/og.jpg',
      siteName: 'Example',
      type: null,
      favicon: 'https://example.com/favicon.ico',
    });

    const result = await enrichBookmark(
      { bookmarkRepository, linkPreviewFetcher, logger: silentLogger },
      { bookmarkId, userId: 'user-1' }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.ogFetchStatus).toBe('processed');
    expect(result.value.ogPreview).toEqual({
      title: 'Example Page',
      description: 'A great example',
      image: 'https://example.com/og.jpg',
      siteName: 'Example',
      type: null,
      favicon: 'https://example.com/favicon.ico',
    });
    expect(result.value.ogFetchedAt).not.toBeNull();
    expect(linkPreviewFetcher.fetchPreviewCalls).toEqual(['https://example.com/page']);
  });

  it('returns NOT_FOUND for non-existent bookmark', async () => {
    const result = await enrichBookmark(
      { bookmarkRepository, linkPreviewFetcher, logger: silentLogger },
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

    const result = await enrichBookmark(
      { bookmarkRepository, linkPreviewFetcher, logger: silentLogger },
      { bookmarkId: createResult.value.id, userId: 'wrong-user' }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  });

  it('skips already enriched bookmarks', async () => {
    const createResult = await bookmarkRepository.create({
      userId: 'user-1',
      url: 'https://example.com',
      source: 'test',
      sourceId: 'test-1',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const bookmark = createResult.value;
    bookmark.ogFetchStatus = 'processed';
    bookmark.ogPreview = {
      title: 'Already Set',
      description: null,
      image: null,
      siteName: null,
      type: null,
      favicon: null,
    };
    await bookmarkRepository.update(bookmark.id, bookmark);

    const result = await enrichBookmark(
      { bookmarkRepository, linkPreviewFetcher, logger: silentLogger },
      { bookmarkId: bookmark.id, userId: 'user-1' }
    );

    expect(result.ok).toBe(true);
    expect(linkPreviewFetcher.fetchPreviewCalls).toEqual([]);
  });

  it('sets status to failed when preview fetch fails', async () => {
    const createResult = await bookmarkRepository.create({
      userId: 'user-1',
      url: 'https://example.com',
      source: 'test',
      sourceId: 'test-1',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    linkPreviewFetcher.setNextResult({
      ok: false,
      error: { code: 'TIMEOUT', message: 'Request timed out' },
    });

    const result = await enrichBookmark(
      { bookmarkRepository, linkPreviewFetcher, logger: silentLogger },
      { bookmarkId: createResult.value.id, userId: 'user-1' }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ogFetchStatus).toBe('failed');
    expect(result.value.ogPreview).toBeNull();
  });

  it('returns error when findById fails', async () => {
    bookmarkRepository.simulateMethodError('findById', {
      code: 'INTERNAL_ERROR',
      message: 'Database connection failed',
    });

    const result = await enrichBookmark(
      { bookmarkRepository, linkPreviewFetcher, logger: silentLogger },
      { bookmarkId: 'any-id', userId: 'user-1' }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
    expect(result.error.message).toBe('Database connection failed');
  });

  it('handles preview with missing optional fields', async () => {
    const createResult = await bookmarkRepository.create({
      userId: 'user-1',
      url: 'https://example.com/minimal',
      source: 'test',
      sourceId: 'test-2',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    linkPreviewFetcher.setDefaultPreview({
      title: null,
      description: null,
      image: null,
      siteName: null,
      type: null,
      favicon: null,
    });

    const result = await enrichBookmark(
      { bookmarkRepository, linkPreviewFetcher, logger: silentLogger },
      { bookmarkId: createResult.value.id, userId: 'user-1' }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ogFetchStatus).toBe('processed');
    expect(result.value.ogPreview).toEqual({
      title: null,
      description: null,
      image: null,
      siteName: null,
      type: null,
      favicon: null,
    });
  });
});
