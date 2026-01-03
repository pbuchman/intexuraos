import { describe, it, expect } from 'vitest';
import { createFakeImageGenerator } from '../infra/image/index.js';

describe('FakeImageGenerator', () => {
  it('generates an image with correct structure', async () => {
    const generator = createFakeImageGenerator({
      bucketName: 'test-bucket',
      generateId: () => 'test-id-123',
    });

    const result = await generator.generate('A sunset over the ocean', 'gpt-image-1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe('test-id-123');
      expect(result.value.prompt).toBe('A sunset over the ocean');
      expect(result.value.model).toBe('gpt-image-1');
      expect(result.value.thumbnailUrl).toBe(
        'https://storage.googleapis.com/test-bucket/test-id-123/thumbnail.png'
      );
      expect(result.value.fullSizeUrl).toBe(
        'https://storage.googleapis.com/test-bucket/test-id-123/full.png'
      );
      expect(result.value.createdAt).toBeDefined();
    }
  });

  it('uses crypto.randomUUID by default for id generation', async () => {
    const generator = createFakeImageGenerator({
      bucketName: 'test-bucket',
    });

    const result = await generator.generate('A sunset', 'dall-e-3');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    }
  });

  it('preserves prompt and model in generated image', async () => {
    const generator = createFakeImageGenerator({
      bucketName: 'my-bucket',
    });

    const result = await generator.generate('Mountain landscape with snow', 'dall-e-3');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.prompt).toBe('Mountain landscape with snow');
      expect(result.value.model).toBe('dall-e-3');
    }
  });
});
