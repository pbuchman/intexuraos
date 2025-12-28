/**
 * Tests for WhatsAppCloudApiAdapter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WhatsAppCloudApiAdapter } from '../../infra/whatsapp/cloudApiAdapter.js';
import * as whatsappClient from '../../whatsappClient.js';

vi.mock('../../whatsappClient.js', () => ({
  getMediaUrl: vi.fn(),
  downloadMedia: vi.fn(),
  sendWhatsAppMessage: vi.fn(),
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
      vi.mocked(whatsappClient.getMediaUrl).mockResolvedValue({
        success: true,
        data: {
          url: 'https://media.example.com/file.jpg',
          mime_type: 'image/jpeg',
          sha256: 'abc123',
          file_size: 12345,
        },
      });

      const result = await adapter.getMediaUrl('media-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.url).toBe('https://media.example.com/file.jpg');
        expect(result.value.mimeType).toBe('image/jpeg');
        expect(result.value.sha256).toBe('abc123');
        expect(result.value.fileSize).toBe(12345);
      }
      expect(whatsappClient.getMediaUrl).toHaveBeenCalledWith('media-123', accessToken);
    });

    it('returns error when API fails', async () => {
      vi.mocked(whatsappClient.getMediaUrl).mockResolvedValue({
        success: false,
        error: 'Media not found',
      });

      const result = await adapter.getMediaUrl('media-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toBe('Media not found');
      }
    });

    it('returns error when data is undefined', async () => {
      vi.mocked(whatsappClient.getMediaUrl).mockResolvedValue({
        success: true,
      });

      const result = await adapter.getMediaUrl('media-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });
  });

  describe('downloadMedia', () => {
    it('returns buffer on success', async () => {
      const buffer = Buffer.from('test data');
      vi.mocked(whatsappClient.downloadMedia).mockResolvedValue({
        success: true,
        buffer,
      });

      const result = await adapter.downloadMedia('https://media.example.com/file.jpg');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(buffer);
      }
      expect(whatsappClient.downloadMedia).toHaveBeenCalledWith(
        'https://media.example.com/file.jpg',
        accessToken
      );
    });

    it('returns error when download fails', async () => {
      vi.mocked(whatsappClient.downloadMedia).mockResolvedValue({
        success: false,
        error: 'Download failed',
      });

      const result = await adapter.downloadMedia('https://media.example.com/file.jpg');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toBe('Download failed');
      }
    });

    it('returns error when buffer is undefined', async () => {
      vi.mocked(whatsappClient.downloadMedia).mockResolvedValue({
        success: true,
      });

      const result = await adapter.downloadMedia('https://media.example.com/file.jpg');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });
  });

  describe('sendMessage', () => {
    it('returns message ID on success', async () => {
      vi.mocked(whatsappClient.sendWhatsAppMessage).mockResolvedValue({
        success: true,
        messageId: 'wamid.123',
      });

      const result = await adapter.sendMessage('phone-123', '+1234567890', 'Hello!');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.messageId).toBe('wamid.123');
      }
      expect(whatsappClient.sendWhatsAppMessage).toHaveBeenCalledWith(
        'phone-123',
        '+1234567890',
        'Hello!',
        accessToken,
        undefined
      );
    });

    it('passes replyToMessageId when provided', async () => {
      vi.mocked(whatsappClient.sendWhatsAppMessage).mockResolvedValue({
        success: true,
        messageId: 'wamid.456',
      });

      const result = await adapter.sendMessage(
        'phone-123',
        '+1234567890',
        'Reply!',
        'wamid.original'
      );

      expect(result.ok).toBe(true);
      expect(whatsappClient.sendWhatsAppMessage).toHaveBeenCalledWith(
        'phone-123',
        '+1234567890',
        'Reply!',
        accessToken,
        'wamid.original'
      );
    });

    it('returns error when send fails', async () => {
      vi.mocked(whatsappClient.sendWhatsAppMessage).mockResolvedValue({
        success: false,
        error: 'Send failed',
      });

      const result = await adapter.sendMessage('phone-123', '+1234567890', 'Hello!');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toBe('Send failed');
      }
    });

    it('returns error when messageId is undefined', async () => {
      vi.mocked(whatsappClient.sendWhatsAppMessage).mockResolvedValue({
        success: true,
      });

      const result = await adapter.sendMessage('phone-123', '+1234567890', 'Hello!');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });
  });
});
