/**
 * Tests for GcsMediaStorageAdapter.
 * Uses vi.mock() to mock @google-cloud/storage for unit testing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GcsMediaStorageAdapter } from '../../infra/gcs/index.js';

const mockSave = vi.fn();
const mockDelete = vi.fn();
const mockGetSignedUrl = vi.fn();
const mockFile = vi.fn(() => ({
  save: mockSave,
  delete: mockDelete,
  getSignedUrl: mockGetSignedUrl,
}));
const mockBucket = vi.fn(() => ({
  file: mockFile,
}));

vi.mock('@google-cloud/storage', () => {
  return {
    Storage: class MockStorage {
      bucket = mockBucket;
    },
  };
});

describe('GcsMediaStorageAdapter', () => {
  let adapter: GcsMediaStorageAdapter;
  const testBucketName = 'test-media-bucket';

  beforeEach(() => {
    adapter = new GcsMediaStorageAdapter(testBucketName);
    vi.clearAllMocks();
  });

  describe('upload', () => {
    it('returns gcsPath on successful upload', async () => {
      mockSave.mockResolvedValue(undefined);

      const buffer = Buffer.from('fake image data');
      const result = await adapter.upload(
        'user-123',
        'msg-456',
        'media-789',
        'jpg',
        buffer,
        'image/jpeg'
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.gcsPath).toBe('whatsapp/user-123/msg-456/media-789.jpg');
      }
      expect(mockBucket).toHaveBeenCalledWith(testBucketName);
      expect(mockFile).toHaveBeenCalledWith('whatsapp/user-123/msg-456/media-789.jpg');
      expect(mockSave).toHaveBeenCalledWith(buffer, {
        contentType: 'image/jpeg',
        resumable: false,
        metadata: {
          cacheControl: 'private, max-age=31536000',
        },
      });
    });

    it('returns error when save fails', async () => {
      mockSave.mockRejectedValue(new Error('GCS upload failed'));

      const buffer = Buffer.from('fake image data');
      const result = await adapter.upload(
        'user-123',
        'msg-456',
        'media-789',
        'jpg',
        buffer,
        'image/jpeg'
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
        expect(result.error.message).toContain('Failed to upload media');
        expect(result.error.message).toContain('GCS upload failed');
      }
    });

    it('returns error with unknown message when non-Error is thrown', async () => {
      mockSave.mockRejectedValue('string error');

      const buffer = Buffer.from('fake image data');
      const result = await adapter.upload(
        'user-123',
        'msg-456',
        'media-789',
        'jpg',
        buffer,
        'image/jpeg'
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
        expect(result.error.message).toContain('Unknown GCS error');
      }
    });
  });

  describe('uploadThumbnail', () => {
    it('returns gcsPath on successful thumbnail upload', async () => {
      mockSave.mockResolvedValue(undefined);

      const buffer = Buffer.from('fake thumbnail data');
      const result = await adapter.uploadThumbnail(
        'user-123',
        'msg-456',
        'media-789',
        'jpg',
        buffer,
        'image/jpeg'
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.gcsPath).toBe('whatsapp/user-123/msg-456/media-789_thumb.jpg');
      }
      expect(mockFile).toHaveBeenCalledWith('whatsapp/user-123/msg-456/media-789_thumb.jpg');
    });

    it('returns error when thumbnail save fails', async () => {
      mockSave.mockRejectedValue(new Error('GCS thumbnail upload failed'));

      const buffer = Buffer.from('fake thumbnail data');
      const result = await adapter.uploadThumbnail(
        'user-123',
        'msg-456',
        'media-789',
        'jpg',
        buffer,
        'image/jpeg'
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
        expect(result.error.message).toContain('Failed to upload thumbnail');
        expect(result.error.message).toContain('GCS thumbnail upload failed');
      }
    });

    it('returns error with unknown message when non-Error is thrown', async () => {
      mockSave.mockRejectedValue({ code: 500 });

      const buffer = Buffer.from('fake thumbnail data');
      const result = await adapter.uploadThumbnail(
        'user-123',
        'msg-456',
        'media-789',
        'jpg',
        buffer,
        'image/jpeg'
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
        expect(result.error.message).toContain('Unknown GCS error');
      }
    });
  });

  describe('delete', () => {
    it('returns success on successful delete', async () => {
      mockDelete.mockResolvedValue([{}]);

      const result = await adapter.delete('whatsapp/user-123/msg-456/media-789.jpg');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeUndefined();
      }
      expect(mockFile).toHaveBeenCalledWith('whatsapp/user-123/msg-456/media-789.jpg');
      expect(mockDelete).toHaveBeenCalledWith({ ignoreNotFound: true });
    });

    it('returns error when delete fails', async () => {
      mockDelete.mockRejectedValue(new Error('GCS delete failed'));

      const result = await adapter.delete('whatsapp/user-123/msg-456/media-789.jpg');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
        expect(result.error.message).toContain('Failed to delete file');
        expect(result.error.message).toContain('GCS delete failed');
      }
    });

    it('returns error with unknown message when non-Error is thrown', async () => {
      mockDelete.mockRejectedValue(undefined);

      const result = await adapter.delete('whatsapp/user-123/msg-456/media-789.jpg');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
        expect(result.error.message).toContain('Unknown GCS error');
      }
    });
  });

  describe('getSignedUrl', () => {
    it('returns signed URL on success with default TTL', async () => {
      const signedUrl = 'https://storage.googleapis.com/test-media-bucket/signed';
      mockGetSignedUrl.mockResolvedValue([signedUrl]);

      const result = await adapter.getSignedUrl('whatsapp/user-123/msg-456/media-789.jpg');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(signedUrl);
      }
      expect(mockFile).toHaveBeenCalledWith('whatsapp/user-123/msg-456/media-789.jpg');
      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          version: 'v4',
          action: 'read',
        })
      );
      // Default TTL is 900 seconds (15 minutes)
      const call = mockGetSignedUrl.mock.calls[0] ?? [];
      const options = (call[0] ?? {}) as { expires: number };
      // Check that expires is approximately 900 seconds from now
      const expectedExpires = Date.now() + 900 * 1000;
      expect(options.expires).toBeGreaterThan(expectedExpires - 5000);
      expect(options.expires).toBeLessThan(expectedExpires + 5000);
    });

    it('returns signed URL on success with custom TTL', async () => {
      const signedUrl = 'https://storage.googleapis.com/test-media-bucket/signed-custom';
      mockGetSignedUrl.mockResolvedValue([signedUrl]);

      const customTtl = 3600; // 1 hour
      const result = await adapter.getSignedUrl(
        'whatsapp/user-123/msg-456/media-789.jpg',
        customTtl
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(signedUrl);
      }
      const call = mockGetSignedUrl.mock.calls[0] ?? [];
      const options = (call[0] ?? {}) as { expires: number };
      // Check that expires is approximately customTtl seconds from now
      const expectedExpires = Date.now() + customTtl * 1000;
      expect(options.expires).toBeGreaterThan(expectedExpires - 5000);
      expect(options.expires).toBeLessThan(expectedExpires + 5000);
    });

    it('returns error when getSignedUrl fails', async () => {
      mockGetSignedUrl.mockRejectedValue(new Error('GCS signed URL failed'));

      const result = await adapter.getSignedUrl('whatsapp/user-123/msg-456/media-789.jpg');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
        expect(result.error.message).toContain('Failed to generate signed URL');
        expect(result.error.message).toContain('GCS signed URL failed');
      }
    });

    it('returns error with unknown message when non-Error is thrown', async () => {
      mockGetSignedUrl.mockRejectedValue(null);

      const result = await adapter.getSignedUrl('whatsapp/user-123/msg-456/media-789.jpg');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
        expect(result.error.message).toContain('Unknown GCS error');
      }
    });
  });
});
