import { ok, type Result, type Logger } from '@intexuraos/common-core';
import type { GeneratedImageRepository, ImageStorage } from '../domain/index.js';

export interface DeleteImageInput {
  id: string;
}

export interface DeleteImageOutput {
  deleted: boolean;
}

export type DeleteImageUseCase = (
  input: DeleteImageInput
) => Promise<Result<DeleteImageOutput, never>>;

export interface DeleteImageDeps {
  generatedImageRepository: GeneratedImageRepository;
  imageStorage: ImageStorage;
  logger: Logger;
}

export function createDeleteImageUseCase(deps: DeleteImageDeps): DeleteImageUseCase {
  return async (input: DeleteImageInput) => {
    // Look up image to get slug
    const imageResult = await deps.generatedImageRepository.findById(input.id);
    const slug = imageResult.ok ? imageResult.value.slug : undefined;

    // Delete from storage (log error but continue)
    const storageResult = await deps.imageStorage.delete(input.id, slug);
    if (!storageResult.ok) {
      deps.logger.error(
        { error: storageResult.error, imageId: input.id },
        'Failed to delete image from storage'
      );
    }

    // Delete from repository (log error but continue)
    const repoResult = await deps.generatedImageRepository.delete(input.id);
    if (!repoResult.ok) {
      deps.logger.error(
        { error: repoResult.error, imageId: input.id },
        'Failed to delete image from database'
      );
    }

    deps.logger.info({ imageId: input.id, slug }, 'Image deleted via internal endpoint');

    return ok({ deleted: true });
  };
}
