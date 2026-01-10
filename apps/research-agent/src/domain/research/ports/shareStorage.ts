/**
 * Port for storing and deleting shared research HTML files.
 */
import type { Result } from '@intexuraos/common-core';

export interface ShareStorageError {
  code: 'UPLOAD_FAILED' | 'DELETE_FAILED';
  message: string;
}

export interface ShareStoragePort {
  upload(
    fileName: string,
    htmlContent: string
  ): Promise<Result<{ gcsPath: string }, ShareStorageError>>;
  delete(gcsPath: string): Promise<Result<void, ShareStorageError>>;
}
