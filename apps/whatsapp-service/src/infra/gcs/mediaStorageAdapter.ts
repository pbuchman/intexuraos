/**
 * GCS Media Storage Adapter.
 * Implements MediaStoragePort using Google Cloud Storage.
 */
import { Storage } from '@google-cloud/storage';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type { WhatsAppError, MediaStoragePort, UploadResult } from '../../domain/whatsapp/index.js';

const DEFAULT_SIGNED_URL_TTL_SECONDS = 900; // 15 minutes

/**
 * Generate deterministic GCS path for media.
 * Format: whatsapp/{userId}/{messageId}/{mediaId}.{ext}
 */
function buildMediaPath(
  userId: string,
  messageId: string,
  mediaId: string,
  extension: string
): string {
  return `whatsapp/${userId}/${messageId}/${mediaId}.${extension}`;
}

/**
 * Generate deterministic GCS path for thumbnail.
 * Format: whatsapp/{userId}/{messageId}/{mediaId}_thumb.{ext}
 */
function buildThumbnailPath(
  userId: string,
  messageId: string,
  mediaId: string,
  extension: string
): string {
  return `whatsapp/${userId}/${messageId}/${mediaId}_thumb.${extension}`;
}

function buildPrivateMediaPath(
  userId: string,
  messageId: string,
  mediaId: string,
  extension: string
): string {
  return `whatsapp/private/${userId}/${messageId}/${mediaId}.${extension}`;
}

function buildPrivateThumbnailPath(
  userId: string,
  messageId: string,
  mediaId: string,
  extension: string
): string {
  return `whatsapp/private/${userId}/${messageId}/${mediaId}_thumb.${extension}`;
}

async function saveObject(
  storage: Storage,
  bucketName: string,
  gcsPath: string,
  buffer: Buffer,
  contentType: string,
  errorLabel: string
): Promise<Result<UploadResult, WhatsAppError>> {
  try {
    const bucket = storage.bucket(bucketName);
    const file = bucket.file(gcsPath);

    await file.save(buffer, {
      contentType,
      resumable: false,
      metadata: {
        cacheControl: 'private, max-age=31536000',
      },
    });

    return ok({ gcsPath });
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `${errorLabel}: ${getErrorMessage(error, 'Unknown GCS error')}`,
    });
  }
}

/**
 * GCS implementation of MediaStoragePort.
 */
export class GcsMediaStorageAdapter implements MediaStoragePort {
  private readonly storage: Storage;
  private readonly bucketName: string;

  constructor(bucketName: string) {
    this.storage = new Storage();
    this.bucketName = bucketName;
  }

  async upload(
    userId: string,
    messageId: string,
    mediaId: string,
    extension: string,
    buffer: Buffer,
    contentType: string
  ): Promise<Result<UploadResult, WhatsAppError>> {
    return await saveObject(
      this.storage,
      this.bucketName,
      buildMediaPath(userId, messageId, mediaId, extension),
      buffer,
      contentType,
      'Failed to upload media'
    );
  }

  async uploadThumbnail(
    userId: string,
    messageId: string,
    mediaId: string,
    extension: string,
    buffer: Buffer,
    contentType: string
  ): Promise<Result<UploadResult, WhatsAppError>> {
    return await saveObject(
      this.storage,
      this.bucketName,
      buildThumbnailPath(userId, messageId, mediaId, extension),
      buffer,
      contentType,
      'Failed to upload thumbnail'
    );
  }

  async uploadPrivateMedia(
    userId: string,
    messageId: string,
    mediaId: string,
    extension: string,
    buffer: Buffer,
    contentType: string
  ): Promise<Result<UploadResult, WhatsAppError>> {
    return await saveObject(
      this.storage,
      this.bucketName,
      buildPrivateMediaPath(userId, messageId, mediaId, extension),
      buffer,
      contentType,
      'Failed to upload private media'
    );
  }

  async uploadPrivateThumbnail(
    userId: string,
    messageId: string,
    mediaId: string,
    extension: string,
    buffer: Buffer,
    contentType: string
  ): Promise<Result<UploadResult, WhatsAppError>> {
    return await saveObject(
      this.storage,
      this.bucketName,
      buildPrivateThumbnailPath(userId, messageId, mediaId, extension),
      buffer,
      contentType,
      'Failed to upload private thumbnail'
    );
  }

  async delete(gcsPath: string): Promise<Result<void, WhatsAppError>> {
    try {
      const bucket = this.storage.bucket(this.bucketName);
      const file = bucket.file(gcsPath);

      await file.delete({ ignoreNotFound: true });

      return ok(undefined);
    } catch (error) {
      return err({
        code: 'PERSISTENCE_ERROR',
        message: `Failed to delete file: ${getErrorMessage(error, 'Unknown GCS error')}`,
      });
    }
  }

  async getSignedUrl(
    gcsPath: string,
    ttlSeconds: number = DEFAULT_SIGNED_URL_TTL_SECONDS
  ): Promise<Result<string, WhatsAppError>> {
    try {
      const bucket = this.storage.bucket(this.bucketName);
      const file = bucket.file(gcsPath);

      const [url] = await file.getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + ttlSeconds * 1000,
      });

      return ok(url);
    } catch (error) {
      return err({
        code: 'PERSISTENCE_ERROR',
        message: `Failed to generate signed URL: ${getErrorMessage(error, 'Unknown GCS error')}`,
      });
    }
  }
}
