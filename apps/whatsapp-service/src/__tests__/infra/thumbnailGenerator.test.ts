/**
 * Tests for thumbnail generator.
 * Uses real sharp library with sample image buffers.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import sharp from 'sharp';

async function createTestImage(
  width: number,
  height: number,
  format: 'jpeg' | 'png' | 'webp' = 'jpeg'
): Promise<Buffer> {
  const image = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 100, g: 150, b: 200 },
    },
  });
  switch (format) {
    case 'png':
      return await image.png().toBuffer();
    case 'webp':
      return await image.webp().toBuffer();
    default:
      return await image.jpeg().toBuffer();
  }
}
describe('generateThumbnail', () => {
  // Reset modules after each test to ensure clean state
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  describe('successful thumbnail generation', () => {
    it('resizes landscape image to max 256px width', async () => {
      const { generateThumbnail } = await import('../../infra/media/index.js');
      const imageBuffer = await createTestImage(800, 600);
      const result = await generateThumbnail(imageBuffer);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.mimeType).toBe('image/jpeg');
        const metadata = await sharp(result.value.buffer).metadata();
        expect(metadata.width).toBe(256);
      }
    });
    it('resizes portrait image to max 256px height', async () => {
      const { generateThumbnail } = await import('../../infra/media/index.js');
      const imageBuffer = await createTestImage(600, 800);
      const result = await generateThumbnail(imageBuffer);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const metadata = await sharp(result.value.buffer).metadata();
        expect(metadata.height).toBe(256);
      }
    });
    it('resizes square image correctly', async () => {
      const { generateThumbnail } = await import('../../infra/media/index.js');
      const imageBuffer = await createTestImage(500, 500);
      const result = await generateThumbnail(imageBuffer);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const metadata = await sharp(result.value.buffer).metadata();
        expect(metadata.width).toBe(256);
        expect(metadata.height).toBe(256);
      }
    });
    it('converts PNG to JPEG', async () => {
      const { generateThumbnail } = await import('../../infra/media/index.js');
      const imageBuffer = await createTestImage(400, 300, 'png');
      const result = await generateThumbnail(imageBuffer);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.mimeType).toBe('image/jpeg');
        const metadata = await sharp(result.value.buffer).metadata();
        expect(metadata.format).toBe('jpeg');
      }
    });
    it('converts WebP to JPEG', async () => {
      const { generateThumbnail } = await import('../../infra/media/index.js');
      const imageBuffer = await createTestImage(400, 300, 'webp');
      const result = await generateThumbnail(imageBuffer);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const metadata = await sharp(result.value.buffer).metadata();
        expect(metadata.format).toBe('jpeg');
      }
    });
  });
  describe('error handling', () => {
    it('returns error for invalid image buffer', async () => {
      const { generateThumbnail } = await import('../../infra/media/index.js');
      const invalidBuffer = Buffer.from('not an image');
      const result = await generateThumbnail(invalidBuffer);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });
    it('returns error for empty buffer', async () => {
      const { generateThumbnail } = await import('../../infra/media/index.js');
      const emptyBuffer = Buffer.alloc(0);
      const result = await generateThumbnail(emptyBuffer);
      expect(result.ok).toBe(false);
    });
  });

  describe('dimension validation', () => {
    /**
     * Helper to mock sharp with specific metadata for dimension validation tests.
     */
    function mockSharpWithMetadata(metadata: { width?: number; height?: number }): void {
      vi.doMock('sharp', () => {
        const mockInstance = {
          metadata: vi.fn().mockResolvedValue(metadata),
          resize: vi.fn().mockReturnThis(),
          jpeg: vi.fn().mockReturnThis(),
          toBuffer: vi.fn().mockResolvedValue(Buffer.from('thumbnail')),
        };
        const mockSharp = vi.fn(() => mockInstance);
        return { default: mockSharp };
      });
    }

    it('returns validation error when image has no width', async () => {
      mockSharpWithMetadata({ height: 100 });

      const { generateThumbnail } = await import('../../infra/media/index.js');
      const imageBuffer = Buffer.from('test image');
      const result = await generateThumbnail(imageBuffer);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toBe('Could not determine image dimensions');
      }
    });

    it('returns validation error when image has no height', async () => {
      mockSharpWithMetadata({ width: 100 });

      const { generateThumbnail } = await import('../../infra/media/index.js');
      const imageBuffer = Buffer.from('test image');
      const result = await generateThumbnail(imageBuffer);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toBe('Could not determine image dimensions');
      }
    });

    it('returns validation error when image has zero width', async () => {
      mockSharpWithMetadata({ width: 0, height: 100 });

      const { generateThumbnail } = await import('../../infra/media/index.js');
      const imageBuffer = Buffer.from('test image');
      const result = await generateThumbnail(imageBuffer);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toBe('Could not determine image dimensions');
      }
    });

    it('returns validation error when image has zero height', async () => {
      mockSharpWithMetadata({ width: 100, height: 0 });

      const { generateThumbnail } = await import('../../infra/media/index.js');
      const imageBuffer = Buffer.from('test image');
      const result = await generateThumbnail(imageBuffer);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toBe('Could not determine image dimensions');
      }
    });
  });
});
