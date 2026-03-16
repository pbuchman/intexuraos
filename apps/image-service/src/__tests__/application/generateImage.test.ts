import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import { LlmProviders, LlmModels } from '@intexuraos/llm-contract';
import type { ImageGenerationModel, ImageGenerationModelConfig, ImageGenerator } from '../../domain/index.js';
import { createGenerateImageUseCase } from '../../application/generateImage.js';
import {
  FakeUserServiceClient,
  FakeImageGenerator,
  FakeGeneratedImageRepository,
  FakeImageStorage,
  createFakeLogger,
} from '../fakes.js';

const fakeLogger = createFakeLogger();

const modelConfig: ImageGenerationModelConfig = {
  provider: LlmProviders.OpenAI,
  modelId: LlmModels.GPTImage1,
};

describe('createGenerateImageUseCase', () => {
  let fakeUserClient: FakeUserServiceClient;
  let fakeGenerator: FakeImageGenerator;
  let fakeRepo: FakeGeneratedImageRepository;
  let fakeStorage: FakeImageStorage;
  let createImageGeneratorSpy: ReturnType<
    typeof vi.fn<(model: ImageGenerationModel, apiKey: string, userId: string, logger: Logger) => ImageGenerator>
  >;

  beforeEach(() => {
    fakeUserClient = new FakeUserServiceClient();
    fakeGenerator = new FakeImageGenerator();
    fakeRepo = new FakeGeneratedImageRepository();
    fakeStorage = new FakeImageStorage();
    createImageGeneratorSpy = vi.fn<
      (model: ImageGenerationModel, apiKey: string, userId: string, logger: Logger) => ImageGenerator
    >(() => fakeGenerator);
    vi.clearAllMocks();
  });

  function createUseCase(): ReturnType<typeof createGenerateImageUseCase> {
    return createGenerateImageUseCase(
      {
        userServiceClient: fakeUserClient,
        createImageGenerator: createImageGeneratorSpy,
        generatedImageRepository: fakeRepo,
        imageStorage: fakeStorage,
        logger: fakeLogger,
      },
      modelConfig
    );
  }

  it('returns image data on success', async () => {
    fakeUserClient.setApiKeys({ openai: 'test-key' });
    const useCase = createUseCase();

    const result = await useCase({
      prompt: 'A cat in a hat',
      model: LlmModels.GPTImage1,
      userId: 'user-1',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe('test-generated-id');
    expect(result.value.thumbnailUrl).toContain('thumbnail');
    expect(result.value.fullSizeUrl).toContain('full');
    expect(createImageGeneratorSpy).toHaveBeenCalledWith(
      LlmModels.GPTImage1,
      'test-key',
      'user-1',
      fakeLogger
    );
  });

  it('saves image with slug when title provided', async () => {
    fakeUserClient.setApiKeys({ openai: 'test-key' });
    const useCase = createUseCase();

    const result = await useCase({
      prompt: 'A cat in a hat',
      model: LlmModels.GPTImage1,
      userId: 'user-1',
      title: 'My Cool Title',
    });

    expect(result.ok).toBe(true);
    const savedImage = fakeRepo.getImage('test-generated-id');
    expect(savedImage).toBeDefined();
    expect(savedImage?.slug).toBe('my-cool-title');
  });

  it('returns API_KEYS_UNAVAILABLE when user-service fails', async () => {
    fakeUserClient.setFailNext(true);
    const useCase = createUseCase();

    const result = await useCase({
      prompt: 'A cat in a hat',
      model: LlmModels.GPTImage1,
      userId: 'user-1',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('API_KEYS_UNAVAILABLE');
  });

  it('returns MISSING_API_KEY when provider key is absent', async () => {
    fakeUserClient.setApiKeys({});
    const useCase = createUseCase();

    const result = await useCase({
      prompt: 'A cat in a hat',
      model: LlmModels.GPTImage1,
      userId: 'user-1',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('MISSING_API_KEY');
  });

  it('returns GENERATION_FAILED when image generator fails', async () => {
    fakeUserClient.setApiKeys({ openai: 'test-key' });
    fakeGenerator.setFailNext(true);
    const useCase = createUseCase();

    const result = await useCase({
      prompt: 'A cat in a hat',
      model: LlmModels.GPTImage1,
      userId: 'user-1',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('GENERATION_FAILED');
  });

  it('returns SAVE_FAILED and cleans up storage when DB save fails', async () => {
    fakeUserClient.setApiKeys({ openai: 'test-key' });
    fakeRepo.setFailNextSave(true);
    const useCase = createUseCase();

    const result = await useCase({
      prompt: 'A cat in a hat',
      model: LlmModels.GPTImage1,
      userId: 'user-1',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('SAVE_FAILED');
    expect(fakeStorage.hasImage('test-generated-id')).toBe(false);
  });

  it('returns SAVE_FAILED and logs when both save and cleanup fail', async () => {
    fakeUserClient.setApiKeys({ openai: 'test-key' });
    fakeRepo.setFailNextSave(true);
    fakeStorage.setFailNextDelete(true);
    const useCase = createUseCase();

    const result = await useCase({
      prompt: 'A cat in a hat',
      model: LlmModels.GPTImage1,
      userId: 'user-1',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('SAVE_FAILED');
    expect(fakeLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ imageId: 'test-generated-id' }),
      'Failed to cleanup orphaned image'
    );
  });
});
