import type { Result } from '@intexuraos/common-core';

export interface ImageUrls {
  thumbnailUrl: string;
  fullSizeUrl: string;
}

export interface StorageError {
  code: 'STORAGE_ERROR';
  message: string;
}

export interface UploadOptions {
  slug?: string | undefined;
}

export interface ImageStorage {
  upload(
    id: string,
    imageData: Buffer,
    options?: UploadOptions
  ): Promise<Result<ImageUrls, StorageError>>;
  delete(id: string, slug?: string): Promise<Result<void, StorageError>>;
}
