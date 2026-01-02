/**
 * GCS adapter for storing shared research HTML files.
 */
import { Storage } from '@google-cloud/storage';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type { ShareStorageError, ShareStoragePort } from '../../domain/research/index.js';

export interface ShareStorageConfig {
  bucketName: string;
}

export class GcsShareStorageAdapter implements ShareStoragePort {
  private readonly storage: Storage;
  private readonly bucketName: string;

  constructor(config: ShareStorageConfig) {
    this.storage = new Storage();
    this.bucketName = config.bucketName;
  }

  async upload(
    fileName: string,
    htmlContent: string
  ): Promise<Result<{ gcsPath: string }, ShareStorageError>> {
    try {
      const bucket = this.storage.bucket(this.bucketName);
      const file = bucket.file(fileName);

      await file.save(htmlContent, {
        contentType: 'text/html; charset=utf-8',
        metadata: {
          cacheControl: 'public, max-age=3600',
        },
      });

      return ok({ gcsPath: fileName });
    } catch (error) {
      return err({
        code: 'UPLOAD_FAILED',
        message: getErrorMessage(error, 'Unknown upload error'),
      });
    }
  }

  async delete(gcsPath: string): Promise<Result<void, ShareStorageError>> {
    try {
      const bucket = this.storage.bucket(this.bucketName);
      const file = bucket.file(gcsPath);

      await file.delete({ ignoreNotFound: true });

      return ok(undefined);
    } catch (error) {
      return err({
        code: 'DELETE_FAILED',
        message: getErrorMessage(error, 'Unknown delete error'),
      });
    }
  }
}

export function createShareStorage(config: ShareStorageConfig): ShareStoragePort {
  return new GcsShareStorageAdapter(config);
}
