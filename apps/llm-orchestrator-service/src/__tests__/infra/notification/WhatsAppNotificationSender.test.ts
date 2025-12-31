/**
 * Tests for WhatsAppNotificationSender.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSendTextMessage = vi.fn();

vi.mock('@intexuraos/infra-whatsapp', () => ({
  createWhatsAppClient: vi.fn().mockReturnValue({
    sendTextMessage: mockSendTextMessage,
  }),
}));

const { WhatsAppNotificationSender } =
  await import('../../../infra/notification/WhatsAppNotificationSender.js');

describe('WhatsAppNotificationSender', () => {
  const mockConfig = {
    phoneNumberId: 'test-phone-id',
    accessToken: 'test-token',
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
      mockSendTextMessage.mockResolvedValue({ ok: true, value: { messageId: 'msg-123' } });

      const sender = new WhatsAppNotificationSender(mockConfig, mockUserPhoneLookup);
      const result = await sender.sendResearchComplete('user-123', 'research-456', 'AI Research');

      expect(result.ok).toBe(true);
      expect(mockSendTextMessage).toHaveBeenCalledWith({
        to: '+1234567890',
        message: expect.stringContaining('AI Research'),
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
      expect(mockSendTextMessage).not.toHaveBeenCalled();
    });

    it('returns error when send fails', async () => {
      mockUserPhoneLookup.getPhoneNumber.mockResolvedValue('+1234567890');
      mockSendTextMessage.mockResolvedValue({
        ok: false,
        error: { code: 'SEND_ERROR', message: 'Failed to send' },
      });

      const sender = new WhatsAppNotificationSender(mockConfig, mockUserPhoneLookup);
      const result = await sender.sendResearchComplete('user-123', 'research-456', 'Test');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SEND_FAILED');
      }
    });

    it('formats message with title', async () => {
      mockUserPhoneLookup.getPhoneNumber.mockResolvedValue('+1234567890');
      mockSendTextMessage.mockResolvedValue({ ok: true, value: { messageId: 'msg-123' } });

      const sender = new WhatsAppNotificationSender(mockConfig, mockUserPhoneLookup);
      await sender.sendResearchComplete('user-123', 'research-456', 'My Research Title');

      expect(mockSendTextMessage).toHaveBeenCalledWith({
        to: '+1234567890',
        message: expect.stringContaining('"My Research Title"'),
      });
    });

    it('uses default title when empty', async () => {
      mockUserPhoneLookup.getPhoneNumber.mockResolvedValue('+1234567890');
      mockSendTextMessage.mockResolvedValue({ ok: true, value: { messageId: 'msg-123' } });

      const sender = new WhatsAppNotificationSender(mockConfig, mockUserPhoneLookup);
      await sender.sendResearchComplete('user-123', 'research-456', '');

      expect(mockSendTextMessage).toHaveBeenCalledWith({
        to: '+1234567890',
        message: expect.stringContaining('Untitled Research'),
      });
    });

    it('includes Research Complete header in message', async () => {
      mockUserPhoneLookup.getPhoneNumber.mockResolvedValue('+1234567890');
      mockSendTextMessage.mockResolvedValue({ ok: true, value: { messageId: 'msg-123' } });

      const sender = new WhatsAppNotificationSender(mockConfig, mockUserPhoneLookup);
      await sender.sendResearchComplete('user-123', 'research-456', 'Test');

      expect(mockSendTextMessage).toHaveBeenCalledWith({
        to: '+1234567890',
        message: expect.stringContaining('Research Complete!'),
      });
    });
  });
});
