/**
 * GCS Media Storage Adapter.
 * Implements MediaStoragePort using Google Cloud Storage.
 */
import { Storage } from '@google-cloud/storage';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type {
  WhatsAppError,
  MediaStoragePort,
  PrivateMediaDeletionBatchInput,
  PrivateMediaDeletionBatchResult,
  UploadResult,
} from '../../domain/whatsapp/index.js';

const DEFAULT_SIGNED_URL_TTL_SECONDS = 900; // 15 minutes

export type GcsFailureReason =
  | 'authentication_failed'
  | 'permission_denied'
  | 'not_found'
  | 'rate_limited'
  | 'network'
  | 'precondition_failed'
  | 'invalid_request'
  | 'upstream'
  | 'unknown';

export interface GcsMediaStorageOptions {
  projectId?: string;
  keyFilename?: string;
}

export function classifyGcsFailure(error: unknown): GcsFailureReason {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
  if (code === 401) return 'authentication_failed';
  if (code === 403) return 'permission_denied';
  if (code === 404) return 'not_found';
  if (code === 408 || code === 429) return 'rate_limited';
  if (code === 412) return 'precondition_failed';
  if (code === 400) return 'invalid_request';
  if (typeof code === 'number' && code >= 500 && code <= 599) return 'upstream';
  if (
    code === 'ECONNRESET' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'ETIMEDOUT'
  ) {
    return 'network';
  }
  return 'unknown';
}

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
      details: { storageFailureReason: classifyGcsFailure(error) },
    });
  }
}

/**
 * GCS implementation of MediaStoragePort.
 */
export class GcsMediaStorageAdapter implements MediaStoragePort {
  private readonly storage: Storage;
  private readonly bucketName: string;

  constructor(bucketName: string, options: GcsMediaStorageOptions = {}) {
    this.storage =
      options.projectId === undefined && options.keyFilename === undefined
        ? new Storage()
        : new Storage(options);
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

  async deletePrivateMediaBatch(
    input: PrivateMediaDeletionBatchInput
  ): Promise<Result<PrivateMediaDeletionBatchResult, WhatsAppError>> {
    const prefix = `whatsapp/private/${input.userId}/`;
    try {
      const options = {
        autoPaginate: false as const,
        maxResults: input.limit,
        prefix,
        ...(input.cursor === undefined ? {} : { startOffset: input.cursor }),
      };
      const [files] = await this.storage.bucket(this.bucketName).getFiles(options);
      const lastFile = files.at(-1);
      if (lastFile === undefined) {
        return ok({ status: 'empty', deletedCount: 0 });
      }

      const outcomes = await Promise.allSettled(
        files.map(async (file) => {
          await file.delete({ ignoreNotFound: true });
        })
      );
      const deletedCount = outcomes.filter((outcome) => outcome.status === 'fulfilled').length;
      if (deletedCount !== files.length) {
        return ok({ status: 'retry', deletedCount });
      }

      return ok({
        status: 'advanced',
        deletedCount,
        nextCursor: lastFile.name,
      });
    } catch {
      return err({
        code: 'PERSISTENCE_ERROR',
        message: 'Failed to list private media for erasure',
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
