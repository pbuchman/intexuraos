/**
 * Port for thumbnail generation operations.
 * Abstracts image processing from the domain layer.
 */
import type { Result } from '@intexuraos/common-core';
import type { InboxError } from './repositories.js';

/**
 * Result of thumbnail generation.
 */
export interface ThumbnailResult {
  buffer: Buffer;
  mimeType: string;
  width: number;
  height: number;
}

/**
 * Port for thumbnail generation.
 */
export interface ThumbnailGeneratorPort {
  /**
   * Generate a thumbnail from an image buffer.
   * @param imageBuffer - Original image content
   * @returns Thumbnail buffer and metadata
   */
  generate(imageBuffer: Buffer): Promise<Result<ThumbnailResult, InboxError>>;
}
