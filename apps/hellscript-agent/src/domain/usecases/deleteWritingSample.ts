import type { Result } from '@intexuraos/common-core';
import type { WritingConfigRepository } from '../ports/writingConfigRepository.js';
import type { WritingCategory } from '../models/writingCategory.js';

export { SampleNotFoundError } from '../errors.js';

export interface DeleteWritingSampleDeps {
  writingConfigRepository: WritingConfigRepository;
}

export async function deleteWritingSample(
  deps: DeleteWritingSampleDeps,
  userId: string,
  sampleId: string,
  category: WritingCategory
): Promise<Result<void>> {
  return await deps.writingConfigRepository.deleteSample(userId, sampleId, category);
}
