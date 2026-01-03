import type { Result } from '@intexuraos/common-core';

export interface ImageUrls {
  thumbnailUrl: string;
  fullSizeUrl: string;
}

export interface StorageError {
  code: 'STORAGE_ERROR';
  message: string;
}

export interface ImageStorage {
  upload(id: string, imageData: Buffer): Promise<Result<ImageUrls, StorageError>>;
}
