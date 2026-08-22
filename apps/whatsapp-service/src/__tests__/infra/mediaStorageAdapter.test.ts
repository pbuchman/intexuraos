/**
 * Tests for GcsMediaStorageAdapter.
 * Uses vi.mock() to mock @google-cloud/storage for unit testing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyGcsFailure, GcsMediaStorageAdapter } from '../../infra/gcs/index.js';

const mockSave = vi.fn();
const mockDelete = vi.fn();
const mockGetSignedUrl = vi.fn();
const mockGetFiles = vi.fn();
const mockStorageConstructor = vi.fn();
const mockFile = vi.fn(() => ({
  save: mockSave,
  delete: mockDelete,
  getSignedUrl: mockGetSignedUrl,
}));
const mockBucket = vi.fn(() => ({
  file: mockFile,
  getFiles: mockGetFiles,
}));

vi.mock('@google-cloud/storage', () => {
  return {
    Storage: class MockStorage {
      constructor(options?: unknown) {
        mockStorageConstructor(options);
      }

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
    mockGetFiles.mockReset();
  });

  it('classifies only closed safe GCS failure reasons', () => {
    expect(classifyGcsFailure({ code: 401 })).toBe('authentication_failed');
    expect(classifyGcsFailure({ code: 403 })).toBe('permission_denied');
    expect(classifyGcsFailure({ code: 404 })).toBe('not_found');
    expect(classifyGcsFailure({ code: 408 })).toBe('rate_limited');
    expect(classifyGcsFailure({ code: 400 })).toBe('invalid_request');
    expect(classifyGcsFailure({ code: 503 })).toBe('upstream');
    expect(classifyGcsFailure({ code: 'ETIMEDOUT' })).toBe('network');
    expect(classifyGcsFailure({ code: 412 })).toBe('precondition_failed');
    expect(classifyGcsFailure(new Error('sensitive raw detail'))).toBe('unknown');
  });

  it('binds GCS to the configured runtime project and credential file', () => {
    new GcsMediaStorageAdapter(testBucketName, {
      projectId: 'intexuraos-dev-pbuchman',
      keyFilename: '/home/deploy/runtime-sa-key.json',
    });

    expect(mockStorageConstructor).toHaveBeenLastCalledWith({
      projectId: 'intexuraos-dev-pbuchman',
      keyFilename: '/home/deploy/runtime-sa-key.json',
    });
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
        expect(result.error.message).toContain('string error');
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

  it('stores private WhatsApp media under the private prefix', async () => {
    mockSave.mockResolvedValue(undefined);

    const buffer = Buffer.from('private-image-bytes');
    const original = await adapter.uploadPrivateMedia(
      'user-123',
      'message-456',
      'media-789',
      'jpg',
      buffer,
      'image/jpeg'
    );
    const thumbnail = await adapter.uploadPrivateThumbnail(
      'user-123',
      'message-456',
      'media-789',
      'jpg',
      Buffer.from('thumbnail-bytes'),
      'image/jpeg'
    );

    expect(original.ok).toBe(true);
    expect(thumbnail.ok).toBe(true);
    if (!original.ok) throw new Error(original.error.message);
    if (!thumbnail.ok) throw new Error(thumbnail.error.message);
    expect(original.value.gcsPath).toBe('whatsapp/private/user-123/message-456/media-789.jpg');
    expect(thumbnail.value.gcsPath).toBe(
      'whatsapp/private/user-123/message-456/media-789_thumb.jpg'
    );
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

  describe('deletePrivateMediaBatch', () => {
    type BatchDelete = (input: {
      userId: string;
      cursor?: string;
      limit: number;
    }) => Promise<unknown>;

    function batchDelete(): BatchDelete | undefined {
      return (adapter as unknown as { deletePrivateMediaBatch?: BatchDelete })
        .deletePrivateMediaBatch;
    }

    it('deletes one bounded private-prefix page and returns a durable name cursor', async () => {
      const deleteFirst = vi.fn().mockResolvedValue(undefined);
      const deleteSecond = vi.fn().mockResolvedValue(undefined);
      mockGetFiles.mockResolvedValue([
        [
          { name: 'whatsapp/private/user-123/message-a/thumb.jpg', delete: deleteFirst },
          { name: 'whatsapp/private/user-123/message-b/original.jpg', delete: deleteSecond },
        ],
      ]);

      const operation = batchDelete();
      expect(operation).toBeDefined();
      if (operation === undefined) return;
      const result = await operation.call(adapter, {
        userId: 'user-123',
        cursor: 'whatsapp/private/user-123/message-a/original.jpg',
        limit: 2,
      });

      expect(result).toEqual({
        ok: true,
        value: {
          status: 'advanced',
          deletedCount: 2,
          nextCursor: 'whatsapp/private/user-123/message-b/original.jpg',
        },
      });
      expect(mockGetFiles).toHaveBeenCalledWith({
        autoPaginate: false,
        maxResults: 2,
        prefix: 'whatsapp/private/user-123/',
        startOffset: 'whatsapp/private/user-123/message-a/original.jpg',
      });
      expect(deleteFirst).toHaveBeenCalledWith({ ignoreNotFound: true });
      expect(deleteSecond).toHaveBeenCalledWith({ ignoreNotFound: true });
    });

    it('returns retry progress without advancing the cursor after a partial delete failure', async () => {
      const deleted = vi.fn().mockResolvedValue(undefined);
      const failed = vi.fn().mockRejectedValue(new Error('private object name'));
      mockGetFiles.mockResolvedValue([
        [
          { name: 'whatsapp/private/user-secret/message-a/original.jpg', delete: deleted },
          { name: 'whatsapp/private/user-secret/message-b/thumb.jpg', delete: failed },
        ],
      ]);

      const operation = batchDelete();
      expect(operation).toBeDefined();
      if (operation === undefined) return;
      const result = await operation.call(adapter, {
        userId: 'user-secret',
        limit: 20,
      });

      expect(result).toEqual({
        ok: true,
        value: { status: 'retry', deletedCount: 1 },
      });
      expect(JSON.stringify(result)).not.toContain('user-secret');
      expect(JSON.stringify(result)).not.toContain('message-b');
    });

    it('requires a zero-object page before reporting the prefix empty', async () => {
      mockGetFiles.mockResolvedValue([[]]);

      const operation = batchDelete();
      expect(operation).toBeDefined();
      if (operation === undefined) return;
      const result = await operation.call(adapter, {
        userId: 'user-123',
        limit: 20,
      });

      expect(result).toEqual({
        ok: true,
        value: { status: 'empty', deletedCount: 0 },
      });
      expect(mockGetFiles).toHaveBeenCalledWith({
        autoPaginate: false,
        maxResults: 20,
        prefix: 'whatsapp/private/user-123/',
      });
    });

    it('returns a content-free retryable error when listing the prefix fails', async () => {
      mockGetFiles.mockRejectedValue(
        new Error('whatsapp/private/user-secret/message-secret/original.jpg')
      );

      const operation = batchDelete();
      expect(operation).toBeDefined();
      if (operation === undefined) return;
      const result = await operation.call(adapter, {
        userId: 'user-secret',
        limit: 20,
      });

      expect(result).toEqual({
        ok: false,
        error: {
          code: 'PERSISTENCE_ERROR',
          message: 'Failed to list private media for erasure',
        },
      });
      expect(JSON.stringify(result)).not.toContain('user-secret');
      expect(JSON.stringify(result)).not.toContain('message-secret');
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
