/**
 * Tests for WhatsAppNotificationSender.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import type { UserPhoneLookup } from '../../../infra/notification/WhatsAppNotificationSender.js';

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

  let mockGetPhoneNumber: ReturnType<typeof vi.fn<(userId: string) => Promise<string | null>>>;
  let mockUserPhoneLookup: UserPhoneLookup;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPhoneNumber = vi.fn<(userId: string) => Promise<string | null>>();
    mockUserPhoneLookup = {
      getPhoneNumber: mockGetPhoneNumber,
    };
  });

  describe('sendResearchComplete', () => {
    it('sends message when user has phone number', async () => {
      mockGetPhoneNumber.mockResolvedValue('+1234567890');
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
      mockGetPhoneNumber.mockResolvedValue(null);

      const sender = new WhatsAppNotificationSender(mockConfig, mockUserPhoneLookup);
      const result = await sender.sendResearchComplete('user-123', 'research-456', 'Test');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('USER_NOT_CONNECTED');
      }
      expect(mockPublishSendMessage).not.toHaveBeenCalled();
    });

    it('returns error when send fails', async () => {
      mockGetPhoneNumber.mockResolvedValue('+1234567890');
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
      mockGetPhoneNumber.mockResolvedValue('+1234567890');
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
      mockGetPhoneNumber.mockResolvedValue('+1234567890');
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
      mockGetPhoneNumber.mockResolvedValue('+1234567890');
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

  describe('sendLlmFailure', () => {
    it('sends message when user has phone number', async () => {
      mockGetPhoneNumber.mockResolvedValue('+1234567890');
      mockPublishSendMessage.mockResolvedValue(ok(undefined));

      const sender = new WhatsAppNotificationSender(mockConfig, mockUserPhoneLookup);
      const result = await sender.sendLlmFailure('user-123', 'research-456', 'google', 'API Error');

      expect(result.ok).toBe(true);
      expect(mockPublishSendMessage).toHaveBeenCalledWith({
        userId: 'user-123',
        phoneNumber: '+1234567890',
        message: expect.stringContaining('Google'),
        correlationId: 'research-failure-research-456',
      });
    });

    it('returns error when user has no phone number', async () => {
      mockGetPhoneNumber.mockResolvedValue(null);

      const sender = new WhatsAppNotificationSender(mockConfig, mockUserPhoneLookup);
      const result = await sender.sendLlmFailure(
        'user-123',
        'research-456',
        'openai',
        'Rate limit'
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('USER_NOT_CONNECTED');
      }
      expect(mockPublishSendMessage).not.toHaveBeenCalled();
    });

    it('returns error when send fails', async () => {
      mockGetPhoneNumber.mockResolvedValue('+1234567890');
      mockPublishSendMessage.mockResolvedValue(
        err({ code: 'PUBLISH_FAILED', message: 'Failed to publish' })
      );

      const sender = new WhatsAppNotificationSender(mockConfig, mockUserPhoneLookup);
      const result = await sender.sendLlmFailure('user-123', 'research-456', 'anthropic', 'Error');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SEND_FAILED');
      }
    });

    it('includes provider name in message', async () => {
      mockGetPhoneNumber.mockResolvedValue('+1234567890');
      mockPublishSendMessage.mockResolvedValue(ok(undefined));

      const sender = new WhatsAppNotificationSender(mockConfig, mockUserPhoneLookup);
      await sender.sendLlmFailure('user-123', 'research-456', 'openai', 'Timeout');

      expect(mockPublishSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('OpenAI'),
        })
      );
    });

    it('includes error message in notification', async () => {
      mockGetPhoneNumber.mockResolvedValue('+1234567890');
      mockPublishSendMessage.mockResolvedValue(ok(undefined));

      const sender = new WhatsAppNotificationSender(mockConfig, mockUserPhoneLookup);
      await sender.sendLlmFailure('user-123', 'research-456', 'google', 'Rate limit exceeded');

      expect(mockPublishSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Rate limit exceeded'),
        })
      );
    });
  });
});
