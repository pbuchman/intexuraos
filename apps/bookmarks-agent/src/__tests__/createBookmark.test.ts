import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createBookmark, type CreateBookmarkDeps } from '../domain/usecases/createBookmark.js';
import { FakeBookmarkRepository } from './fakeBookmarkRepository.js';
import { FakeEnrichPublisher } from './fakeEnrichPublisher.js';
import type { CreateBookmarkInput } from '../domain/models/bookmark.js';

describe('createBookmark', () => {
  let fakeBookmarkRepository: FakeBookmarkRepository;
  let fakeEnrichPublisher: FakeEnrichPublisher;
  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  };

  beforeEach(() => {
    fakeBookmarkRepository = new FakeBookmarkRepository();
    fakeEnrichPublisher = new FakeEnrichPublisher();
  });

  it('creates a bookmark successfully', async () => {
    const deps: CreateBookmarkDeps = {
      bookmarkRepository: fakeBookmarkRepository,
      logger: mockLogger,
    };

    const input: CreateBookmarkInput = {
      userId: 'user-1',
      url: 'https://example.com',
      title: 'Test Bookmark',
      source: 'test',
      sourceId: 'test-123',
    };

    const result = await createBookmark(deps, input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeDefined();
    expect(result.value.url).toBe('https://example.com');
    expect(result.value.userId).toBe('user-1');
  });

  it('publishes enrich event when enrichPublisher is provided', async () => {
    const deps: CreateBookmarkDeps = {
      bookmarkRepository: fakeBookmarkRepository,
      enrichPublisher: fakeEnrichPublisher,
      logger: mockLogger,
    };

    const input: CreateBookmarkInput = {
      userId: 'user-1',
      url: 'https://example.com',
      title: 'Test Bookmark',
      source: 'test',
      sourceId: 'test-123',
    };

    const result = await createBookmark(deps, input);

    expect(result.ok).toBe(true);
    expect(fakeEnrichPublisher.publishedEvents).toHaveLength(1);
    const event = fakeEnrichPublisher.publishedEvents[0];
    expect(event).toBeDefined();
    expect(event?.type).toBe('bookmarks.enrich');
    if (!result.ok) return;
    expect(event?.bookmarkId).toBe(result.value.id);
    expect(event?.userId).toBe('user-1');
    expect(event?.url).toBe('https://example.com');
  });

  it('does not publish when enrichPublisher is not provided', async () => {
    const deps: CreateBookmarkDeps = {
      bookmarkRepository: fakeBookmarkRepository,
      logger: mockLogger,
    };

    const input: CreateBookmarkInput = {
      userId: 'user-1',
      url: 'https://example.com',
      title: 'Test Bookmark',
      source: 'test',
      sourceId: 'test-123',
    };

    const result = await createBookmark(deps, input);

    expect(result.ok).toBe(true);
    // Should not crash and enrichPublisher should be undefined
    expect(fakeEnrichPublisher.publishedEvents).toHaveLength(0);
  });

  it('succeeds even when enrichPublisher fails', async () => {
    const deps: CreateBookmarkDeps = {
      bookmarkRepository: fakeBookmarkRepository,
      enrichPublisher: fakeEnrichPublisher,
      logger: mockLogger,
    };

    fakeEnrichPublisher.setNextError({
      code: 'PUBLISH_FAILED',
      message: 'Pub/Sub temporarily unavailable',
    });

    const input: CreateBookmarkInput = {
      userId: 'user-1',
      url: 'https://example.com',
      title: 'Test Bookmark',
      source: 'test',
      sourceId: 'test-123',
    };

    const result = await createBookmark(deps, input);

    // Should still create the bookmark successfully even if publish fails
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeDefined();
    expect(result.value.url).toBe('https://example.com');
    // Wait for the fire-and-forget publish to complete and catch the error
    // Use a small delay to allow the promise to settle
    await new Promise((resolve) => setTimeout(resolve, 10));
    // The publish error was logged (we can check mockLogger.warn was called)
    expect(mockLogger.warn).toHaveBeenCalled();
  });
});
