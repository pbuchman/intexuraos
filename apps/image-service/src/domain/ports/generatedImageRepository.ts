import type { Result } from '@intexuraos/common-core';
import type { GeneratedImage } from '../models/index.js';

export interface RepositoryError {
  code: 'NOT_FOUND' | 'WRITE_FAILED' | 'READ_FAILED';
  message: string;
}

export interface GeneratedImageRepository {
  save(image: GeneratedImage): Promise<Result<GeneratedImage, RepositoryError>>;
  findById(id: string): Promise<Result<GeneratedImage, RepositoryError>>;
  delete(id: string): Promise<Result<void, RepositoryError>>;
}
