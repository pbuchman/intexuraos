/**
 * Port for media storage operations.
 * Abstracts GCS-specific operations for the domain layer.
 */
import type { Result } from '@intexuraos/common';
import type { InboxError } from './repositories.js';

/**
 * Result of a media upload operation.
 */
export interface UploadResult {
  /**
   * GCS path where the file was stored.
   */
  gcsPath: string;
}

/**
 * Port for media storage operations (upload, delete, signed URL).
 */
export interface MediaStoragePort {
  /**
   * Upload media file to storage.
   *
   * @param userId - User ID for path generation
   * @param messageId - Message ID for path generation
   * @param mediaId - WhatsApp media ID
   * @param extension - File extension (without dot)
   * @param buffer - File content
   * @param contentType - MIME type of the file
   * @returns GCS path of the uploaded file
   */
  upload(
    userId: string,
    messageId: string,
    mediaId: string,
    extension: string,
    buffer: Buffer,
    contentType: string
  ): Promise<Result<UploadResult, InboxError>>;

  /**
   * Upload thumbnail to storage.
   *
   * @param userId - User ID for path generation
   * @param messageId - Message ID for path generation
   * @param mediaId - WhatsApp media ID
   * @param extension - File extension (without dot)
   * @param buffer - Thumbnail content
   * @param contentType - MIME type of the thumbnail
   * @returns GCS path of the uploaded thumbnail
   */
  uploadThumbnail(
    userId: string,
    messageId: string,
    mediaId: string,
    extension: string,
    buffer: Buffer,
    contentType: string
  ): Promise<Result<UploadResult, InboxError>>;

  /**
   * Delete a file from storage.
   *
   * @param gcsPath - GCS path of the file to delete
   */
  delete(gcsPath: string): Promise<Result<void, InboxError>>;

  /**
   * Generate a signed URL for file access.
   *
   * @param gcsPath - GCS path of the file
   * @param ttlSeconds - Time-to-live in seconds (default: 900 = 15 minutes)
   * @returns Signed URL for the file
   */
  getSignedUrl(gcsPath: string, ttlSeconds?: number): Promise<Result<string, InboxError>>;
}
