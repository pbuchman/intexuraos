import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import { createGeneratedImageRepository } from '../../../infra/firestore/index.js';
import type { GeneratedImageRepository } from '../../../domain/ports/generatedImageRepository.js';
import type { GeneratedImage } from '../../../domain/index.js';

function createTestImage(overrides: Partial<GeneratedImage> = {}): GeneratedImage {
  return {
    id: 'img-123',
    userId: 'user-123',
    prompt: 'A beautiful sunset over mountains',
    thumbnailUrl: 'https://storage.googleapis.com/bucket/images/img-123/thumbnail.jpg',
    fullSizeUrl: 'https://storage.googleapis.com/bucket/images/img-123/full.png',
    model: 'gpt-image-1',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('GeneratedImageFirestoreRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let repository: GeneratedImageRepository;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Parameters<typeof setFirestore>[0]);
    repository = createGeneratedImageRepository();
  });

  afterEach(() => {
    resetFirestore();
  });

  describe('save', () => {
    it('saves image and returns it', async () => {
      const image = createTestImage();

      const result = await repository.save(image);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe(image.id);
        expect(result.value.prompt).toBe(image.prompt);
        expect(result.value.model).toBe('gpt-image-1');
      }
    });

    it('saves image with all fields', async () => {
      const image = createTestImage({
        id: 'img-456',
        prompt: 'A futuristic city at night',
        model: 'nano-banana-pro',
      });

      const result = await repository.save(image);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('img-456');
        expect(result.value.prompt).toBe('A futuristic city at night');
        expect(result.value.model).toBe('nano-banana-pro');
      }
    });

    it('returns error when save fails', async () => {
      const image = createTestImage();
      fakeFirestore.configure({ errorToThrow: new Error('Firestore write failed') });

      const result = await repository.save(image);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('WRITE_FAILED');
        expect(result.error.message).toContain('Firestore write failed');
      }
    });
  });

  describe('findById', () => {
    it('returns image for existing id', async () => {
      const image = createTestImage();
      await repository.save(image);

      const result = await repository.findById(image.id);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe(image.id);
        expect(result.value.prompt).toBe(image.prompt);
        expect(result.value.thumbnailUrl).toBe(image.thumbnailUrl);
        expect(result.value.fullSizeUrl).toBe(image.fullSizeUrl);
        expect(result.value.model).toBe(image.model);
      }
    });

    it('returns NOT_FOUND for non-existent id', async () => {
      const result = await repository.findById('nonexistent');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
        expect(result.error.message).toContain('nonexistent');
      }
    });

    it('returns error when read fails', async () => {
      const image = createTestImage();
      await repository.save(image);
      fakeFirestore.configure({ errorToThrow: new Error('Firestore read failed') });

      const result = await repository.findById(image.id);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('READ_FAILED');
        expect(result.error.message).toContain('Firestore read failed');
      }
    });
  });
});
