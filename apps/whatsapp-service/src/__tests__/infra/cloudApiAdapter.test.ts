/**
 * Tests for WhatsAppCloudApiAdapter.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '@intexuraos/common-core';
import { WhatsAppCloudApiAdapter } from '../../infra/whatsapp/index.js';

const mockClient = {
  getMediaUrl: vi.fn(),
  downloadMedia: vi.fn(),
  sendTextMessage: vi.fn(),
  markAsRead: vi.fn(),
};

vi.mock('@intexuraos/infra-whatsapp', () => ({
  createWhatsAppClient: vi.fn(() => mockClient),
}));

describe('WhatsAppCloudApiAdapter', () => {
  let adapter: WhatsAppCloudApiAdapter;
  const accessToken = 'test-access-token';

  beforeEach(() => {
    adapter = new WhatsAppCloudApiAdapter(accessToken);
    vi.clearAllMocks();
  });

  describe('getMediaUrl', () => {
    it('returns media URL info on success', async () => {
      mockClient.getMediaUrl.mockResolvedValue(
        ok({
          url: 'https://media.example.com/file.jpg',
          mimeType: 'image/jpeg',
          sha256: 'abc123',
          fileSize: 12345,
        })
      );

      const result = await adapter.getMediaUrl('media-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.url).toBe('https://media.example.com/file.jpg');
        expect(result.value.mimeType).toBe('image/jpeg');
        expect(result.value.sha256).toBe('abc123');
        expect(result.value.fileSize).toBe(12345);
      }
      expect(mockClient.getMediaUrl).toHaveBeenCalledWith('media-123');
    });

    it('returns error when API fails', async () => {
      mockClient.getMediaUrl.mockResolvedValue(
        err({
          code: 'API_ERROR',
          message: 'Media not found',
        })
      );

      const result = await adapter.getMediaUrl('media-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toBe('Media not found');
      }
    });
  });

  describe('downloadMedia', () => {
    it('returns buffer on success', async () => {
      const buffer = Buffer.from('test data');
      mockClient.downloadMedia.mockResolvedValue(ok(buffer));

      const result = await adapter.downloadMedia('https://media.example.com/file.jpg');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(buffer);
      }
      expect(mockClient.downloadMedia).toHaveBeenCalledWith('https://media.example.com/file.jpg');
    });

    it('returns error when download fails', async () => {
      mockClient.downloadMedia.mockResolvedValue(
        err({
          code: 'NETWORK_ERROR',
          message: 'Download failed',
        })
      );

      const result = await adapter.downloadMedia('https://media.example.com/file.jpg');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toBe('Download failed');
      }
    });
  });

  describe('sendMessage', () => {
    it('returns message ID on success', async () => {
      mockClient.sendTextMessage.mockResolvedValue(
        ok({
          messageId: 'wamid.123',
        })
      );

      const result = await adapter.sendMessage('phone-123', '+1234567890', 'Hello!');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.messageId).toBe('wamid.123');
      }
      expect(mockClient.sendTextMessage).toHaveBeenCalledWith({
        to: '+1234567890',
        message: 'Hello!',
        replyToMessageId: undefined,
      });
    });

    it('passes replyToMessageId when provided', async () => {
      mockClient.sendTextMessage.mockResolvedValue(
        ok({
          messageId: 'wamid.456',
        })
      );

      const result = await adapter.sendMessage(
        'phone-123',
        '+1234567890',
        'Reply!',
        'wamid.original'
      );

      expect(result.ok).toBe(true);
      expect(mockClient.sendTextMessage).toHaveBeenCalledWith({
        to: '+1234567890',
        message: 'Reply!',
        replyToMessageId: 'wamid.original',
      });
    });

    it('returns error when send fails', async () => {
      mockClient.sendTextMessage.mockResolvedValue(
        err({
          code: 'API_ERROR',
          message: 'Send failed',
        })
      );

      const result = await adapter.sendMessage('phone-123', '+1234567890', 'Hello!');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toBe('Send failed');
      }
    });
  });

  describe('markAsRead', () => {
    it('marks message as read successfully', async () => {
      mockClient.markAsRead.mockResolvedValue(ok(undefined));

      const result = await adapter.markAsRead('phone-123', 'wamid.original');

      expect(result.ok).toBe(true);
      expect(mockClient.markAsRead).toHaveBeenCalledWith('wamid.original');
    });

    it('returns error when markAsRead fails', async () => {
      mockClient.markAsRead.mockResolvedValue(
        err({
          code: 'API_ERROR',
          message: 'Mark as read failed',
        })
      );

      const result = await adapter.markAsRead('phone-123', 'wamid.original');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toBe('Mark as read failed');
      }
    });
  });
});
