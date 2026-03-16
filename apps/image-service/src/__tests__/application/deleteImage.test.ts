import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LlmModels } from '@intexuraos/llm-contract';
import { createDeleteImageUseCase } from '../../application/deleteImage.js';
import { FakeGeneratedImageRepository, FakeImageStorage, createFakeLogger } from '../fakes.js';

const fakeLogger = createFakeLogger();

describe('createDeleteImageUseCase', () => {
  let fakeRepo: FakeGeneratedImageRepository;
  let fakeStorage: FakeImageStorage;

  beforeEach(() => {
    fakeRepo = new FakeGeneratedImageRepository();
    fakeStorage = new FakeImageStorage();
    vi.clearAllMocks();
  });

  const testImage = {
    id: 'test-image-id',
    userId: 'test-user',
    prompt: 'test prompt',
    thumbnailUrl: 'https://example.com/thumb.jpg',
    fullSizeUrl: 'https://example.com/full.png',
    model: LlmModels.GPTImage1,
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  const testImageWithSlug = { ...testImage, slug: 'my-test-slug' };

  function createUseCase(): ReturnType<typeof createDeleteImageUseCase> {
    return createDeleteImageUseCase({
      generatedImageRepository: fakeRepo,
      imageStorage: fakeStorage,
      logger: fakeLogger,
    });
  }

  it('deletes image from storage and repository', async () => {
    fakeRepo.setImage(testImage);
    const useCase = createUseCase();

    const result = await useCase({ id: 'test-image-id' });

    expect(result.ok).toBe(true);
    expect(fakeRepo.hasImage('test-image-id')).toBe(false);
  });

  it('returns success even when image not found in repository', async () => {
    const useCase = createUseCase();

    const result = await useCase({ id: 'non-existent-id' });

    expect(result.ok).toBe(true);
  });

  it('returns success even when storage delete fails', async () => {
    fakeRepo.setImage(testImage);
    fakeStorage.setFailNextDelete(true);
    const useCase = createUseCase();

    const result = await useCase({ id: 'test-image-id' });

    expect(result.ok).toBe(true);
  });

  it('returns success even when repository delete fails', async () => {
    fakeRepo.setImage(testImage);
    fakeRepo.setFailNextDelete(true);
    const useCase = createUseCase();

    const result = await useCase({ id: 'test-image-id' });

    expect(result.ok).toBe(true);
  });

  it('passes slug to storage.delete when image has slug', async () => {
    fakeRepo.setImage(testImageWithSlug);
    const deleteSpy = vi.spyOn(fakeStorage, 'delete');
    const useCase = createUseCase();

    await useCase({ id: 'test-image-id' });

    expect(deleteSpy).toHaveBeenCalledWith('test-image-id', 'my-test-slug');
  });
});
