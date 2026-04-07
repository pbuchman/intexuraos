import type { Result } from '@intexuraos/common-core';
import type { WritingConfigRepository } from '../ports/writingConfigRepository.js';
import type { WritingCategory } from '../models/writingCategory.js';

export { SampleNotFoundError } from '../errors.js';

export interface UpdateWritingSampleDeps {
  writingConfigRepository: WritingConfigRepository;
}

export async function updateWritingSample(
  deps: UpdateWritingSampleDeps,
  userId: string,
  sampleId: string,
  category: WritingCategory,
  title: string,
  text: string
): Promise<Result<void>> {
  return await deps.writingConfigRepository.updateSample(
    userId,
    sampleId,
    category,
    title,
    text
  );
}
