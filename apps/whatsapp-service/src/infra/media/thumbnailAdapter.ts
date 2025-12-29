/**
 * Adapter for ThumbnailGeneratorPort.
 * Wraps the existing generateThumbnail function as a port implementation.
 */
import type { Result } from '@intexuraos/common-core';
import type {
  ThumbnailGeneratorPort,
  ThumbnailResult,
  InboxError,
} from '../../domain/inbox/index.js';
import { generateThumbnail } from './thumbnailGenerator.js';

/**
 * Thumbnail generator adapter implementation.
 */
export class ThumbnailGeneratorAdapter implements ThumbnailGeneratorPort {
  async generate(imageBuffer: Buffer): Promise<Result<ThumbnailResult, InboxError>> {
    const result = await generateThumbnail(imageBuffer);

    if (!result.ok) {
      return result;
    }

    // Add default dimensions since the existing function doesn't return them
    // The port expects width/height but existing impl doesn't provide them
    return {
      ok: true,
      value: {
        buffer: result.value.buffer,
        mimeType: result.value.mimeType,
        width: 256, // Max edge from generator
        height: 256, // Max edge from generator
      },
    };
  }
}
