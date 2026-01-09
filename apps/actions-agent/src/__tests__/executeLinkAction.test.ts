import { describe, it, expect, beforeEach } from 'vitest';
import { isOk, isErr } from '@intexuraos/common-core';
import { createExecuteLinkActionUseCase } from '../domain/usecases/executeLinkAction.js';
import type { Action } from '../domain/models/action.js';
import {
  FakeActionRepository,
  FakeBookmarksServiceClient,
  FakeWhatsAppSendPublisher,
} from './fakes.js';
import pino from 'pino';

const silentLogger = pino({ level: 'silent' });

describe('executeLinkAction usecase', () => {
  let fakeActionRepo: FakeActionRepository;
  let fakeBookmarksClient: FakeBookmarksServiceClient;
  let fakeWhatsappPublisher: FakeWhatsAppSendPublisher;

  const createAction = (overrides: Partial<Action> = {}): Action => ({
    id: 'action-123',
    userId: 'user-456',
    commandId: 'cmd-789',
    type: 'link',
    confidence: 0.95,
    title: 'Save this article https://example.com/article',
    status: 'awaiting_approval',
    payload: {},
    createdAt: '2025-01-01T12:00:00.000Z',
    updatedAt: '2025-01-01T12:00:00.000Z',
    ...overrides,
  });

  beforeEach(() => {
    fakeActionRepo = new FakeActionRepository();
    fakeBookmarksClient = new FakeBookmarksServiceClient();
    fakeWhatsappPublisher = new FakeWhatsAppSendPublisher();
  });

  it('returns error when action not found', async () => {
    const usecase = createExecuteLinkActionUseCase({
      actionRepository: fakeActionRepo,
      bookmarksServiceClient: fakeBookmarksClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase('non-existent-action');

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toBe('Action not found');
    }
  });

  it('returns completed status for already completed action', async () => {
    const action = createAction({
      status: 'completed',
      payload: { resource_url: '/#/bookmarks/existing-bookmark' },
    });
    await fakeActionRepo.save(action);

    const usecase = createExecuteLinkActionUseCase({
      actionRepository: fakeActionRepo,
      bookmarksServiceClient: fakeBookmarksClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed');
      expect(result.value.resource_url).toBe('/#/bookmarks/existing-bookmark');
    }
  });

  it('returns error for action with invalid status', async () => {
    const action = createAction({ status: 'processing' });
    await fakeActionRepo.save(action);

    const usecase = createExecuteLinkActionUseCase({
      actionRepository: fakeActionRepo,
      bookmarksServiceClient: fakeBookmarksClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('Cannot execute action with status');
    }
  });

  it('creates bookmark using payload.url and updates action to completed on success', async () => {
    const action = createAction({
      status: 'awaiting_approval',
      payload: { url: 'https://example.com/specific-article' },
    });
    await fakeActionRepo.save(action);
    fakeBookmarksClient.setNextBookmarkId('bookmark-new-123');

    const usecase = createExecuteLinkActionUseCase({
      actionRepository: fakeActionRepo,
      bookmarksServiceClient: fakeBookmarksClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed');
      expect(result.value.resource_url).toBe('/#/bookmarks/bookmark-new-123');
    }

    const updatedAction = await fakeActionRepo.getById('action-123');
    expect(updatedAction?.status).toBe('completed');
    expect(updatedAction?.payload['bookmarkId']).toBe('bookmark-new-123');

    const createdBookmarks = fakeBookmarksClient.getCreatedBookmarks();
    expect(createdBookmarks[0]?.url).toBe('https://example.com/specific-article');
  });

  it('extracts URL from title when payload.url is not provided', async () => {
    const action = createAction({
      status: 'awaiting_approval',
      title: 'Check out this link https://news.site.com/story',
      payload: {},
    });
    await fakeActionRepo.save(action);
    fakeBookmarksClient.setNextBookmarkId('extracted-bookmark');

    const usecase = createExecuteLinkActionUseCase({
      actionRepository: fakeActionRepo,
      bookmarksServiceClient: fakeBookmarksClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed');
    }

    const createdBookmarks = fakeBookmarksClient.getCreatedBookmarks();
    expect(createdBookmarks[0]?.url).toBe('https://news.site.com/story');
  });

  it('extracts URL from payload.prompt when not in title or url field', async () => {
    const action = createAction({
      status: 'awaiting_approval',
      title: 'Threads Post Link',
      payload: { prompt: 'save this https://threads.net/post/123' },
    });
    await fakeActionRepo.save(action);
    fakeBookmarksClient.setNextBookmarkId('prompt-extracted-bookmark');

    const usecase = createExecuteLinkActionUseCase({
      actionRepository: fakeActionRepo,
      bookmarksServiceClient: fakeBookmarksClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed');
      expect(result.value.resource_url).toBe('/#/bookmarks/prompt-extracted-bookmark');
    }

    const createdBookmarks = fakeBookmarksClient.getCreatedBookmarks();
    expect(createdBookmarks[0]?.url).toBe('https://threads.net/post/123');
  });

  it('fails when no URL can be extracted', async () => {
    const action = createAction({
      status: 'awaiting_approval',
      title: 'Save this for later',
      payload: {},
    });
    await fakeActionRepo.save(action);

    const usecase = createExecuteLinkActionUseCase({
      actionRepository: fakeActionRepo,
      bookmarksServiceClient: fakeBookmarksClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('failed');
      expect(result.value.error).toContain('No URL found');
    }
  });

  it('updates action to failed when bookmark creation fails', async () => {
    const action = createAction({
      status: 'awaiting_approval',
      payload: { url: 'https://example.com/article' },
    });
    await fakeActionRepo.save(action);
    fakeBookmarksClient.setFailNext(true, new Error('Bookmarks service unavailable'));

    const usecase = createExecuteLinkActionUseCase({
      actionRepository: fakeActionRepo,
      bookmarksServiceClient: fakeBookmarksClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('failed');
      expect(result.value.error).toBe('Bookmarks service unavailable');
    }

    const updatedAction = await fakeActionRepo.getById('action-123');
    expect(updatedAction?.status).toBe('failed');
  });

  it('allows execution from failed status (retry)', async () => {
    const action = createAction({
      status: 'failed',
      payload: { url: 'https://example.com/retry' },
    });
    await fakeActionRepo.save(action);
    fakeBookmarksClient.setNextBookmarkId('retry-bookmark-123');

    const usecase = createExecuteLinkActionUseCase({
      actionRepository: fakeActionRepo,
      bookmarksServiceClient: fakeBookmarksClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed');
    }
  });

  it('publishes WhatsApp notification on success', async () => {
    const action = createAction({
      status: 'awaiting_approval',
      payload: { url: 'https://example.com/article' },
    });
    await fakeActionRepo.save(action);
    fakeBookmarksClient.setNextBookmarkId('notified-bookmark-123');

    const usecase = createExecuteLinkActionUseCase({
      actionRepository: fakeActionRepo,
      bookmarksServiceClient: fakeBookmarksClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    await usecase('action-123');

    const messages = fakeWhatsappPublisher.getSentMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.userId).toBe('user-456');
    expect(messages[0]?.message).toContain('Bookmark saved');
    expect(messages[0]?.message).toContain(
      'https://app.test.com/#/bookmarks/notified-bookmark-123'
    );
  });

  it('succeeds even when WhatsApp notification fails (best-effort)', async () => {
    const action = createAction({
      status: 'awaiting_approval',
      payload: { url: 'https://example.com/article' },
    });
    await fakeActionRepo.save(action);
    fakeWhatsappPublisher.setFailNext(true, {
      code: 'PUBLISH_FAILED',
      message: 'WhatsApp unavailable',
    });

    const usecase = createExecuteLinkActionUseCase({
      actionRepository: fakeActionRepo,
      bookmarksServiceClient: fakeBookmarksClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed');
    }
  });

  it('passes title as bookmark title', async () => {
    const action = createAction({
      status: 'awaiting_approval',
      title: 'Great article about TypeScript',
      payload: { url: 'https://example.com/typescript' },
    });
    await fakeActionRepo.save(action);

    const usecase = createExecuteLinkActionUseCase({
      actionRepository: fakeActionRepo,
      bookmarksServiceClient: fakeBookmarksClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    await usecase('action-123');

    const createdBookmarks = fakeBookmarksClient.getCreatedBookmarks();
    expect(createdBookmarks).toHaveLength(1);
    expect(createdBookmarks[0]).toEqual({
      userId: 'user-456',
      url: 'https://example.com/typescript',
      title: 'Great article about TypeScript',
      tags: [],
      source: 'actions-agent',
      sourceId: 'action-123',
    });
  });

  it('extracts URL with http protocol', async () => {
    const action = createAction({
      status: 'awaiting_approval',
      title: 'Check http://insecure-site.com/page',
      payload: {},
    });
    await fakeActionRepo.save(action);

    const usecase = createExecuteLinkActionUseCase({
      actionRepository: fakeActionRepo,
      bookmarksServiceClient: fakeBookmarksClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    await usecase('action-123');

    const createdBookmarks = fakeBookmarksClient.getCreatedBookmarks();
    expect(createdBookmarks[0]?.url).toBe('http://insecure-site.com/page');
  });
});
