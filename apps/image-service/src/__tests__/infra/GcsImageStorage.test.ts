import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GcsImageStorage } from '../../infra/storage/index.js';

const mockSave = vi.fn();
const mockFile = vi.fn(() => ({
  save: mockSave,
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

vi.mock('sharp', () => {
  return {
    default: vi.fn(() => ({
      metadata: vi.fn().mockResolvedValue({ width: 1024, height: 768 }),
      resize: vi.fn().mockReturnThis(),
      jpeg: vi.fn().mockReturnThis(),
      toBuffer: vi.fn().mockResolvedValue(Buffer.from('thumbnail data')),
    })),
  };
});

describe('GcsImageStorage', () => {
  let storage: GcsImageStorage;
  const testBucketName = 'test-image-bucket';

  beforeEach(() => {
    storage = new GcsImageStorage(testBucketName);
    vi.clearAllMocks();
  });

  describe('upload', () => {
    it('returns URLs on successful upload', async () => {
      mockSave.mockResolvedValue(undefined);

      const buffer = Buffer.from('fake image data');
      const result = await storage.upload('img-123', buffer);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.fullSizeUrl).toBe(
          'https://storage.googleapis.com/test-image-bucket/images/img-123/full.png'
        );
        expect(result.value.thumbnailUrl).toBe(
          'https://storage.googleapis.com/test-image-bucket/images/img-123/thumbnail.jpg'
        );
      }
    });

    it('uploads full image with correct parameters', async () => {
      mockSave.mockResolvedValue(undefined);

      const buffer = Buffer.from('fake image data');
      await storage.upload('img-123', buffer);

      expect(mockBucket).toHaveBeenCalledWith(testBucketName);
      expect(mockFile).toHaveBeenCalledWith('images/img-123/full.png');
      expect(mockSave).toHaveBeenCalledWith(buffer, {
        contentType: 'image/png',
        resumable: false,
        metadata: {
          cacheControl: 'public, max-age=31536000',
        },
      });
    });

    it('uploads thumbnail with correct parameters', async () => {
      mockSave.mockResolvedValue(undefined);

      const buffer = Buffer.from('fake image data');
      await storage.upload('img-123', buffer);

      expect(mockFile).toHaveBeenCalledWith('images/img-123/thumbnail.jpg');
      expect(mockSave).toHaveBeenCalledWith(Buffer.from('thumbnail data'), {
        contentType: 'image/jpeg',
        resumable: false,
        metadata: {
          cacheControl: 'public, max-age=31536000',
        },
      });
    });

    it('returns error when full image save fails', async () => {
      mockSave.mockRejectedValue(new Error('GCS upload failed'));

      const buffer = Buffer.from('fake image data');
      const result = await storage.upload('img-123', buffer);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('STORAGE_ERROR');
        expect(result.error.message).toContain('Failed to upload image');
        expect(result.error.message).toContain('GCS upload failed');
      }
    });

    it('returns error with unknown message when non-Error is thrown', async () => {
      mockSave.mockRejectedValue('string error');

      const buffer = Buffer.from('fake image data');
      const result = await storage.upload('img-123', buffer);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('STORAGE_ERROR');
        expect(result.error.message).toContain('Unknown GCS error');
      }
    });
  });
});
