/**
 * Tests for GcsShareStorageAdapter.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSave = vi.fn();
const mockDelete = vi.fn();

const mockFile = vi.fn().mockReturnValue({
  save: mockSave,
  delete: mockDelete,
});

const mockBucket = vi.fn().mockReturnValue({
  file: mockFile,
});

vi.mock('@google-cloud/storage', () => {
  return {
    Storage: class MockStorage {
      bucket = mockBucket;
    },
  };
});

const { GcsShareStorageAdapter, createShareStorage } =
  await import('../../../infra/gcs/shareStorageAdapter.js');

describe('GcsShareStorageAdapter', () => {
  let adapter: InstanceType<typeof GcsShareStorageAdapter>;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GcsShareStorageAdapter({ bucketName: 'test-bucket' });
  });

  describe('upload', () => {
    it('uploads HTML content to GCS successfully', async () => {
      mockSave.mockResolvedValueOnce(undefined);

      const result = await adapter.upload('research/abc123.html', '<html></html>');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.gcsPath).toBe('research/abc123.html');
      }
      expect(mockBucket).toHaveBeenCalledWith('test-bucket');
      expect(mockFile).toHaveBeenCalledWith('research/abc123.html');
      expect(mockSave).toHaveBeenCalledWith('<html></html>', {
        contentType: 'text/html; charset=utf-8',
        metadata: {
          cacheControl: 'public, max-age=3600',
        },
      });
    });

    it('returns UPLOAD_FAILED error when save fails', async () => {
      mockSave.mockRejectedValueOnce(new Error('GCS upload failed'));

      const result = await adapter.upload('research/abc123.html', '<html></html>');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UPLOAD_FAILED');
        expect(result.error.message).toBe('GCS upload failed');
      }
    });

    it('handles non-Error exceptions', async () => {
      mockSave.mockRejectedValueOnce('string error');

      const result = await adapter.upload('research/abc123.html', '<html></html>');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UPLOAD_FAILED');
        expect(result.error.message).toBe('Unknown upload error');
      }
    });
  });

  describe('delete', () => {
    it('deletes file from GCS successfully', async () => {
      mockDelete.mockResolvedValueOnce(undefined);

      const result = await adapter.delete('research/abc123.html');

      expect(result.ok).toBe(true);
      expect(mockBucket).toHaveBeenCalledWith('test-bucket');
      expect(mockFile).toHaveBeenCalledWith('research/abc123.html');
      expect(mockDelete).toHaveBeenCalledWith({ ignoreNotFound: true });
    });

    it('returns DELETE_FAILED error when delete fails', async () => {
      mockDelete.mockRejectedValueOnce(new Error('GCS delete failed'));

      const result = await adapter.delete('research/abc123.html');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DELETE_FAILED');
        expect(result.error.message).toBe('GCS delete failed');
      }
    });

    it('handles non-Error exceptions', async () => {
      mockDelete.mockRejectedValueOnce('string error');

      const result = await adapter.delete('research/abc123.html');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DELETE_FAILED');
        expect(result.error.message).toBe('Unknown delete error');
      }
    });
  });

  describe('createShareStorage factory', () => {
    it('creates an instance of GcsShareStorageAdapter', () => {
      const storage = createShareStorage({ bucketName: 'factory-bucket' });

      expect(storage).toBeInstanceOf(GcsShareStorageAdapter);
    });
  });
});
