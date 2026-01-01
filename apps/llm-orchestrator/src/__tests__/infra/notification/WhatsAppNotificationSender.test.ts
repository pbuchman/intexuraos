/**
 * Tests for WhatsAppNotificationSender.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';

const mockPublishSendMessage = vi.fn();

vi.mock('@intexuraos/infra-pubsub', () => ({
  createWhatsAppSendPublisher: vi.fn().mockReturnValue({
    publishSendMessage: mockPublishSendMessage,
  }),
}));

const { WhatsAppNotificationSender } =
  await import('../../../infra/notification/WhatsAppNotificationSender.js');

describe('WhatsAppNotificationSender', () => {
  const mockConfig = {
    projectId: 'test-project',
    topicName: 'test-topic',
  };

  let mockUserPhoneLookup: { getPhoneNumber: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUserPhoneLookup = {
      getPhoneNumber: vi.fn(),
    };
  });

  describe('sendResearchComplete', () => {
    it('sends message when user has phone number', async () => {
      mockUserPhoneLookup.getPhoneNumber.mockResolvedValue('+1234567890');
      mockPublishSendMessage.mockResolvedValue(ok(undefined));

      const sender = new WhatsAppNotificationSender(mockConfig, mockUserPhoneLookup);
      const result = await sender.sendResearchComplete('user-123', 'research-456', 'AI Research');

      expect(result.ok).toBe(true);
      expect(mockPublishSendMessage).toHaveBeenCalledWith({
        userId: 'user-123',
        phoneNumber: '+1234567890',
        message: expect.stringContaining('AI Research'),
        correlationId: 'research-research-456',
      });
    });

    it('returns error when user has no phone number', async () => {
      mockUserPhoneLookup.getPhoneNumber.mockResolvedValue(null);

      const sender = new WhatsAppNotificationSender(mockConfig, mockUserPhoneLookup);
      const result = await sender.sendResearchComplete('user-123', 'research-456', 'Test');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('USER_NOT_CONNECTED');
      }
      expect(mockPublishSendMessage).not.toHaveBeenCalled();
    });

    it('returns error when send fails', async () => {
      mockUserPhoneLookup.getPhoneNumber.mockResolvedValue('+1234567890');
      mockPublishSendMessage.mockResolvedValue(
        err({ code: 'PUBLISH_FAILED', message: 'Failed to publish' })
      );

      const sender = new WhatsAppNotificationSender(mockConfig, mockUserPhoneLookup);
      const result = await sender.sendResearchComplete('user-123', 'research-456', 'Test');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SEND_FAILED');
      }
    });

    it('formats message with title', async () => {
      mockUserPhoneLookup.getPhoneNumber.mockResolvedValue('+1234567890');
      mockPublishSendMessage.mockResolvedValue(ok(undefined));

      const sender = new WhatsAppNotificationSender(mockConfig, mockUserPhoneLookup);
      await sender.sendResearchComplete('user-123', 'research-456', 'My Research Title');

      expect(mockPublishSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('"My Research Title"'),
        })
      );
    });

    it('uses default title when empty', async () => {
      mockUserPhoneLookup.getPhoneNumber.mockResolvedValue('+1234567890');
      mockPublishSendMessage.mockResolvedValue(ok(undefined));

      const sender = new WhatsAppNotificationSender(mockConfig, mockUserPhoneLookup);
      await sender.sendResearchComplete('user-123', 'research-456', '');

      expect(mockPublishSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Untitled Research'),
        })
      );
    });

    it('includes Research Complete header in message', async () => {
      mockUserPhoneLookup.getPhoneNumber.mockResolvedValue('+1234567890');
      mockPublishSendMessage.mockResolvedValue(ok(undefined));

      const sender = new WhatsAppNotificationSender(mockConfig, mockUserPhoneLookup);
      await sender.sendResearchComplete('user-123', 'research-456', 'Test');

      expect(mockPublishSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Research Complete!'),
        })
      );
    });
  });
});
