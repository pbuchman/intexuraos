import type { Result } from '@intexuraos/common-core';
import type { WritingConfigRepository } from '../ports/writingConfigRepository.js';
import type { WritingCategory } from '../models/writingCategory.js';
import type { WritingSample } from '../models/writingSample.js';

export interface ListWritingSamplesDeps {
  writingConfigRepository: WritingConfigRepository;
}

export async function listWritingSamples(
  deps: ListWritingSamplesDeps,
  userId: string,
  category: WritingCategory
): Promise<Result<WritingSample[]>> {
  return await deps.writingConfigRepository.listSamples(userId, category);
}
