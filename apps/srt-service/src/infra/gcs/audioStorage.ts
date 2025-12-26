/**
 * GCS Audio Storage Adapter.
 * Provides signed URLs for audio files stored in GCS.
 */
import { Storage } from '@google-cloud/storage';
import pino from 'pino';
import { ok, err, type Result, getErrorMessage } from '@intexuraos/common';
import type { AudioStoragePort, TranscriptionError } from '../../domain/transcription/index.js';

const logger = pino({ name: 'gcs-audio-storage' });

/**
 * Default TTL for signed URLs: 1 hour.
 * Speechmatics jobs typically complete within minutes.
 */
const DEFAULT_SIGNED_URL_TTL_SECONDS = 3600;

/**
 * GCS implementation of AudioStoragePort.
 */
export class GcsAudioStorage implements AudioStoragePort {
  private readonly storage: Storage;
  private readonly bucketName: string;

  constructor(bucketName: string) {
    this.storage = new Storage();
    this.bucketName = bucketName;
  }

  async getSignedUrl(
    gcsPath: string,
    ttlSeconds: number = DEFAULT_SIGNED_URL_TTL_SECONDS
  ): Promise<Result<string, TranscriptionError>> {
    try {
      const bucket = this.storage.bucket(this.bucketName);
      const file = bucket.file(gcsPath);

      logger.info(
        {
          bucketName: this.bucketName,
          gcsPath,
          ttlSeconds,
        },
        'Generating signed URL for audio file'
      );

      const [url] = await file.getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + ttlSeconds * 1000,
      });

      logger.info(
        {
          bucketName: this.bucketName,
          gcsPath,
          urlGenerated: true,
        },
        'Signed URL generated successfully'
      );

      return ok(url);
    } catch (error) {
      logger.error(
        {
          bucketName: this.bucketName,
          gcsPath,
          error: getErrorMessage(error),
        },
        'Failed to generate signed URL'
      );
      return err({
        code: 'PERSISTENCE_ERROR',
        message: `Failed to generate signed URL: ${getErrorMessage(error, 'Unknown GCS error')}`,
      });
    }
  }
}
