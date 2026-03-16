import { ok, err, type Result, type Logger } from '@intexuraos/common-core';
import type {
  ImageGenerationModel,
  ImageGenerationModelConfig,
  GeneratedImageRepository,
  ImageGenerator,
  ImageStorage,
} from '../domain/index.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import { slugify } from './slugify.js';

export interface GenerateImageInput {
  prompt: string;
  model: ImageGenerationModel;
  userId: string;
  title?: string | undefined;
}

export interface GenerateImageOutput {
  id: string;
  thumbnailUrl: string;
  fullSizeUrl: string;
}

export type GenerateImageError =
  | { code: 'API_KEYS_UNAVAILABLE'; message: string }
  | { code: 'MISSING_API_KEY'; message: string; provider: string }
  | { code: 'GENERATION_FAILED'; message: string }
  | { code: 'SAVE_FAILED'; message: string };

export type GenerateImageUseCase = (
  input: GenerateImageInput
) => Promise<Result<GenerateImageOutput, GenerateImageError>>;

export interface GenerateImageDeps {
  userServiceClient: UserServiceClient;
  createImageGenerator: (
    model: ImageGenerationModel,
    apiKey: string,
    userId: string,
    logger: Logger
  ) => ImageGenerator;
  generatedImageRepository: GeneratedImageRepository;
  imageStorage: ImageStorage;
  logger: Logger;
}

export function createGenerateImageUseCase(
  deps: GenerateImageDeps,
  modelConfig: ImageGenerationModelConfig
): GenerateImageUseCase {
  return async (input: GenerateImageInput) => {
    const slug = input.title !== undefined ? slugify(input.title) : undefined;
    deps.logger.info(
      { model: input.model, userId: input.userId, promptLength: input.prompt.length, slug },
      'Processing image generation request'
    );

    // 1. Resolve API keys
    deps.logger.info({ userId: input.userId }, 'Fetching API keys from user-service');
    const keysResult = await deps.userServiceClient.getApiKeys(input.userId);
    if (!keysResult.ok) {
      deps.logger.error(
        { userId: input.userId, error: keysResult.error },
        'Failed to get API keys from user-service'
      );
      return err({
        code: 'API_KEYS_UNAVAILABLE',
        message: `Failed to get API keys: ${keysResult.error.message}`,
      });
    }

    // 2. Check provider key
    const apiKey = keysResult.value[modelConfig.provider];
    if (apiKey === undefined) {
      deps.logger.warn(
        { userId: input.userId, provider: modelConfig.provider },
        'User missing required API key for image generation'
      );
      return err({
        code: 'MISSING_API_KEY',
        message: `No ${modelConfig.provider} API key configured`,
        provider: modelConfig.provider,
      });
    }

    // 3. Generate image
    deps.logger.info({ model: input.model, provider: modelConfig.provider }, 'Starting image generation');
    const imageGenerator = deps.createImageGenerator(input.model, apiKey, input.userId, deps.logger);
    const result = await imageGenerator.generate(input.prompt, { slug });

    if (!result.ok) {
      deps.logger.error(
        { model: input.model, errorCode: result.error.code, errorMessage: result.error.message },
        'Image generation failed'
      );
      return err({ code: 'GENERATION_FAILED', message: result.error.message });
    }

    // 4. Save to repository
    deps.logger.info({ model: input.model, imageId: result.value.id }, 'Image generated, saving to database');
    const generatedImage = {
      ...result.value,
      userId: input.userId,
      ...(slug !== undefined && { slug }),
    };
    const saveResult = await deps.generatedImageRepository.save(generatedImage);
    if (!saveResult.ok) {
      deps.logger.error(
        { error: saveResult.error, imageId: result.value.id },
        'Failed to save generated image to DB'
      );

      // 5. Cleanup on save failure
      const deleteResult = await deps.imageStorage.delete(result.value.id);
      if (!deleteResult.ok) {
        deps.logger.error(
          { error: deleteResult.error, imageId: result.value.id },
          'Failed to cleanup orphaned image'
        );
      }

      return err({ code: 'SAVE_FAILED', message: 'Failed to save image record' });
    }

    // 6. Success
    deps.logger.info(
      { model: input.model, imageId: result.value.id },
      'Image generation completed successfully'
    );
    return ok({
      id: result.value.id,
      thumbnailUrl: result.value.thumbnailUrl,
      fullSizeUrl: result.value.fullSizeUrl,
    });
  };
}
