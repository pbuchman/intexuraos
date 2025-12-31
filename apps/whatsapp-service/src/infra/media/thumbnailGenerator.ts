/**
 * Thumbnail Generator Service.
 * Uses sharp to create thumbnails for images.
 */
import sharp from 'sharp';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type { InboxError } from '../../domain/inbox/index.js';

const MAX_THUMBNAIL_EDGE = 256;
const JPEG_QUALITY = 80;

/**
 * Result of thumbnail generation.
 */
export interface ThumbnailResult {
  /**
   * Thumbnail image buffer.
   */
  buffer: Buffer;

  /**
   * MIME type of the thumbnail (always image/jpeg).
   */
  mimeType: string;
}

/**
 * Generate a thumbnail from an image buffer.
 * Resizes to max 256px on longest edge, maintaining aspect ratio.
 * Always outputs JPEG for consistent size/format.
 *
 * @param imageBuffer - Original image buffer (JPEG, PNG, WebP, etc.)
 * @returns Thumbnail buffer and mime type, or error
 */
export async function generateThumbnail(
  imageBuffer: Buffer
): Promise<Result<ThumbnailResult, InboxError>> {
  try {
    const image = sharp(imageBuffer);
    const metadata = await image.metadata();

    // Determine resize dimensions maintaining aspect ratio
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;

    if (width === 0 || height === 0) {
      return err({
        code: 'VALIDATION_ERROR',
        message: 'Could not determine image dimensions',
      });
    }

    // Resize to fit within MAX_THUMBNAIL_EDGE on longest side
    const resizeOptions =
      width > height ? { width: MAX_THUMBNAIL_EDGE } : { height: MAX_THUMBNAIL_EDGE };

    const thumbnailBuffer = await image
      .resize(resizeOptions)
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();

    return ok({
      buffer: thumbnailBuffer,
      mimeType: 'image/jpeg',
    });
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to generate thumbnail: ${getErrorMessage(error, 'Unknown sharp error')}`,
    });
  }
}
