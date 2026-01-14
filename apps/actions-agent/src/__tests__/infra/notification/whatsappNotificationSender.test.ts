/**
 * Tests for WhatsAppNotificationSender.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ok } from '@intexuraos/common-core';

const mockPublishSendMessage = vi.fn();

vi.mock('@intexuraos/infra-pubsub', () => ({
  createWhatsAppSendPublisher: vi.fn().mockReturnValue({
    publishSendMessage: mockPublishSendMessage,
  }),
}));

const { createWhatsappNotificationSender } = await import(
  '../../../infra/notification/whatsappNotificationSender.js'
);

describe('createWhatsappNotificationSender', () => {
  const mockConfig = {
    projectId: 'test-project',
    topicName: 'test-topic',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('sendDraftReady', () => {
    it('returns ok on successful notification', async () => {
      mockPublishSendMessage.mockResolvedValue(ok(undefined));

      const sender = createWhatsappNotificationSender(mockConfig);
      const result = await sender.sendDraftReady(
        'user-123',
        'research-456',
        'AI Research Report',
        'https://app.example.com/research/456'
      );

      expect(result.ok).toBe(true);
    });

    it('publishes message with correct userId', async () => {
      mockPublishSendMessage.mockResolvedValue(ok(undefined));

      const sender = createWhatsappNotificationSender(mockConfig);
      await sender.sendDraftReady(
        'user-123',
        'research-456',
        'Test',
        'https://example.com'
      );

      expect(mockPublishSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
        })
      );
    });

    it('formats message with title when provided', async () => {
      mockPublishSendMessage.mockResolvedValue(ok(undefined));

      const sender = createWhatsappNotificationSender(mockConfig);
      await sender.sendDraftReady(
        'user-123',
        'research-789',
        'AI Research Report',
        'https://app.example.com/research/456'
      );

      expect(mockPublishSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('AI Research Report'),
        })
      );
    });

    it('uses Untitled Research when title is empty', async () => {
      mockPublishSendMessage.mockResolvedValue(ok(undefined));

      const sender = createWhatsappNotificationSender(mockConfig);
      await sender.sendDraftReady(
        'user-123',
        'research-456',
        '',
        'https://example.com'
      );

      expect(mockPublishSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Untitled Research'),
        })
      );
    });

    it('includes draft URL in message', async () => {
      mockPublishSendMessage.mockResolvedValue(ok(undefined));

      const sender = createWhatsappNotificationSender(mockConfig);
      await sender.sendDraftReady(
        'user-123',
        'research-456',
        'My Title',
        'https://app.example.com/research/456'
      );

      expect(mockPublishSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('https://app.example.com/research/456'),
        })
      );
    });

    it('includes Research Complete header', async () => {
      mockPublishSendMessage.mockResolvedValue(ok(undefined));

      const sender = createWhatsappNotificationSender(mockConfig);
      await sender.sendDraftReady(
        'user-123',
        'research-456',
        'Test',
        'https://example.com'
      );

      expect(mockPublishSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Research Complete!'),
        })
      );
    });

    it('includes correlationId with research id', async () => {
      mockPublishSendMessage.mockResolvedValue(ok(undefined));

      const sender = createWhatsappNotificationSender(mockConfig);
      await sender.sendDraftReady(
        'user-123',
        'research-abc123',
        'Test',
        'https://example.com'
      );

      expect(mockPublishSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationId: 'research-draft-ready-research-abc123',
        })
      );
    });

    it('formats complete message correctly', async () => {
      mockPublishSendMessage.mockResolvedValue(ok(undefined));

      const sender = createWhatsappNotificationSender(mockConfig);
      await sender.sendDraftReady(
        'user-123',
        'research-456',
        'AI Research Report',
        'https://app.example.com/research/456'
      );

      const expectedMessage =
        'Research Complete!\n\n"AI Research Report"\nhttps://app.example.com/research/456';

      expect(mockPublishSendMessage).toHaveBeenCalledWith({
        userId: 'user-123',
        message: expectedMessage,
        correlationId: 'research-draft-ready-research-456',
      });
    });
  });
});
