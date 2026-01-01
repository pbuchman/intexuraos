/**
 * Tests for ExtractLinkPreviewsUseCase.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type ExtractLinkPreviewsLogger,
  ExtractLinkPreviewsUseCase,
  type LinkPreview,
  type LinkPreviewError,
  type WhatsAppMessage,
} from '../../domain/inbox/index.js';
import type { Result } from '@intexuraos/common-core';
import { FakeLinkPreviewFetcherPort, FakeWhatsAppMessageRepository } from '../fakes.js';

class MockLogger implements ExtractLinkPreviewsLogger {
  infoLogs: { data: Record<string, unknown>; message: string }[] = [];
  errorLogs: { data: Record<string, unknown>; message: string }[] = [];
  info(data: Record<string, unknown>, message: string): void {
    this.infoLogs.push({ data, message });
  }
  error(data: Record<string, unknown>, message: string): void {
    this.errorLogs.push({ data, message });
  }
}
function createTestMessage(): Omit<WhatsAppMessage, 'id'> {
  return {
    userId: 'user-123',
    waMessageId: 'wa-msg-1',
    fromNumber: '+1234567890',
    toNumber: '+0987654321',
    text: 'Hello world',
    mediaType: 'text',
    timestamp: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    webhookEventId: 'event-123',
  };
}
describe('ExtractLinkPreviewsUseCase', () => {
  let messageRepo: FakeWhatsAppMessageRepository;
  let linkPreviewFetcher: FakeLinkPreviewFetcherPort;
  let useCase: ExtractLinkPreviewsUseCase;
  let logger: MockLogger;
  let testMessage: WhatsAppMessage;
  beforeEach(async () => {
    messageRepo = new FakeWhatsAppMessageRepository();
    linkPreviewFetcher = new FakeLinkPreviewFetcherPort();
    useCase = new ExtractLinkPreviewsUseCase({
      messageRepository: messageRepo,
      linkPreviewFetcher,
    });
    logger = new MockLogger();
    const result = await messageRepo.saveMessage(createTestMessage());
    if (result.ok) {
      testMessage = result.value;
    }
  });
  describe('URL extraction', () => {
    it('skips processing when no URLs in text', async () => {
      await useCase.execute(
        { messageId: testMessage.id, userId: 'user-123', text: 'Hello world' },
        logger
      );
      expect(logger.infoLogs.some((l) => l.data['event'] === 'link_preview_no_urls')).toBe(true);
    });
    it('extracts single URL from text', async () => {
      await useCase.execute(
        { messageId: testMessage.id, userId: 'user-123', text: 'Check https://example.com' },
        logger
      );
      expect(logger.infoLogs.some((l) => l.data['event'] === 'link_preview_start')).toBe(true);
      const msg = await messageRepo.getMessage(testMessage.id);
      expect(msg.ok && msg.value?.linkPreview?.status).toBe('completed');
    });
    it('processes only first 3 URLs', async () => {
      await useCase.execute(
        {
          messageId: testMessage.id,
          userId: 'user-123',
          text: 'https://a.com https://b.com https://c.com https://d.com',
        },
        logger
      );
      const startLog = logger.infoLogs.find((l) => l.data['event'] === 'link_preview_start');
      expect(startLog?.data['urlCount']).toBe(3);
    });
    it('deduplicates URLs', async () => {
      await useCase.execute(
        {
          messageId: testMessage.id,
          userId: 'user-123',
          text: 'https://example.com https://example.com',
        },
        logger
      );
      const startLog = logger.infoLogs.find((l) => l.data['event'] === 'link_preview_start');
      expect(startLog?.data['urlCount']).toBe(1);
    });
  });
  describe('fetch results', () => {
    it('updates message with failed state when all fetches fail', async () => {
      linkPreviewFetcher.setFail(true, { code: 'FETCH_FAILED', message: 'Network error' });
      await useCase.execute(
        { messageId: testMessage.id, userId: 'user-123', text: 'https://broken.com' },
        logger
      );
      const msg = await messageRepo.getMessage(testMessage.id);
      expect(msg.ok && msg.value?.linkPreview?.status).toBe('failed');
    });
    it('includes only successful previews when some fail', async () => {
      const customFetcher = {
        fetchPreview(url: string): Promise<Result<LinkPreview, LinkPreviewError>> {
          if (url.includes('broken')) {
            return Promise.resolve({
              ok: false,
              error: { code: 'FETCH_FAILED', message: 'Failed' },
            });
          }
          return Promise.resolve({ ok: true, value: { url, title: 'Title' } });
        },
      };
      const customUseCase = new ExtractLinkPreviewsUseCase({
        messageRepository: messageRepo,
        linkPreviewFetcher: customFetcher,
      });
      await customUseCase.execute(
        {
          messageId: testMessage.id,
          userId: 'user-123',
          text: 'https://ok.com https://broken.com',
        },
        logger
      );
      const msg = await messageRepo.getMessage(testMessage.id);
      expect(msg.ok && msg.value?.linkPreview?.status).toBe('completed');
      if (msg.ok && msg.value?.linkPreview?.status === 'completed') {
        expect(msg.value.linkPreview.previews?.length).toBe(1);
      }
    });
  });
  describe('error handling', () => {
    it('catches unexpected errors', async () => {
      const throwingFetcher = {
        fetchPreview(): Promise<never> {
          return Promise.reject(new Error('Crash'));
        },
      };
      const throwingUseCase = new ExtractLinkPreviewsUseCase({
        messageRepository: messageRepo,
        linkPreviewFetcher: throwingFetcher,
      });
      await throwingUseCase.execute(
        { messageId: testMessage.id, userId: 'user-123', text: 'https://crash.com' },
        logger
      );
      const msg = await messageRepo.getMessage(testMessage.id);
      expect(msg.ok && msg.value?.linkPreview?.status).toBe('failed');
    });

    it('handles non-Error thrown values with fallback message', async () => {
      const throwingFetcher = {
        fetchPreview(): Promise<never> {
          return Promise.reject('string error, not Error instance');
        },
      };
      const throwingUseCase = new ExtractLinkPreviewsUseCase({
        messageRepository: messageRepo,
        linkPreviewFetcher: throwingFetcher,
      });
      await throwingUseCase.execute(
        { messageId: testMessage.id, userId: 'user-123', text: 'https://weird.com' },
        logger
      );
      const msg = await messageRepo.getMessage(testMessage.id);
      expect(msg.ok && msg.value?.linkPreview?.status).toBe('failed');
      if (msg.ok && msg.value?.linkPreview?.status === 'failed') {
        expect(msg.value.linkPreview.error?.message).toBe('Unknown error');
      }
    });

    it('handles malformed HTML with empty preview gracefully', async () => {
      const emptyPreviewFetcher = {
        fetchPreview(url: string): Promise<Result<LinkPreview, LinkPreviewError>> {
          // Returns a preview with only the URL (simulating empty/malformed HTML)
          return Promise.resolve({ ok: true, value: { url } });
        },
      };
      const emptyUseCase = new ExtractLinkPreviewsUseCase({
        messageRepository: messageRepo,
        linkPreviewFetcher: emptyPreviewFetcher,
      });
      await emptyUseCase.execute(
        { messageId: testMessage.id, userId: 'user-123', text: 'https://empty.com' },
        logger
      );
      const msg = await messageRepo.getMessage(testMessage.id);
      expect(msg.ok && msg.value?.linkPreview?.status).toBe('completed');
      if (msg.ok && msg.value?.linkPreview?.status === 'completed') {
        expect(msg.value.linkPreview.previews?.length).toBe(1);
        const preview = msg.value.linkPreview.previews?.[0];
        expect(preview?.url).toBe('https://empty.com');
        expect(preview?.title).toBeUndefined();
        expect(preview?.description).toBeUndefined();
      }
    });
  });
  describe('state transitions', () => {
    it('sets pending state before fetching', async () => {
      let pendingObserved = false;
      const slowFetcher = {
        async fetchPreview(url: string): Promise<Result<LinkPreview, LinkPreviewError>> {
          const msg = await messageRepo.getMessage(testMessage.id);
          if (msg.ok && msg.value?.linkPreview?.status === 'pending') {
            pendingObserved = true;
          }
          return { ok: true, value: { url, title: 'Done' } };
        },
      };
      const slowUseCase = new ExtractLinkPreviewsUseCase({
        messageRepository: messageRepo,
        linkPreviewFetcher: slowFetcher,
      });
      await slowUseCase.execute(
        { messageId: testMessage.id, userId: 'user-123', text: 'https://example.com' },
        logger
      );
      expect(pendingObserved).toBe(true);
    });
  });
});
