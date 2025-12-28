/**
 * Tests for ThumbnailGeneratorAdapter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ThumbnailGeneratorAdapter } from '../../infra/media/index.js';
import * as thumbnailGenerator from '../../infra/media/thumbnailGenerator.js';
import { ok, err } from '@intexuraos/common';

vi.mock('../../infra/media/thumbnailGenerator.js', () => ({
  generateThumbnail: vi.fn(),
}));

describe('ThumbnailGeneratorAdapter', () => {
  let adapter: ThumbnailGeneratorAdapter;

  beforeEach(() => {
    adapter = new ThumbnailGeneratorAdapter();
    vi.clearAllMocks();
  });

  describe('generate', () => {
    it('returns thumbnail result on success', async () => {
      const inputBuffer = Buffer.from('fake image data');
      const thumbnailBuffer = Buffer.from('fake thumbnail data');

      vi.mocked(thumbnailGenerator.generateThumbnail).mockResolvedValue(
        ok({
          buffer: thumbnailBuffer,
          mimeType: 'image/jpeg',
        })
      );

      const result = await adapter.generate(inputBuffer);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.buffer).toBe(thumbnailBuffer);
        expect(result.value.mimeType).toBe('image/jpeg');
        expect(result.value.width).toBe(256);
        expect(result.value.height).toBe(256);
      }
      expect(thumbnailGenerator.generateThumbnail).toHaveBeenCalledWith(inputBuffer);
    });

    it('passes through error from generator', async () => {
      const inputBuffer = Buffer.from('fake image data');

      vi.mocked(thumbnailGenerator.generateThumbnail).mockResolvedValue(
        err({
          code: 'INTERNAL_ERROR',
          message: 'Failed to generate thumbnail',
        })
      );

      const result = await adapter.generate(inputBuffer);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toBe('Failed to generate thumbnail');
      }
    });
  });
});
