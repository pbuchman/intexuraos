import type { Result } from '@intexuraos/common-core';
import type { WritingConfigRepository } from '../ports/writingConfigRepository.js';
import type { WritingCategory } from '../models/writingCategory.js';
import { SampleNotFoundError } from './updateWritingSample.js';

export interface DeleteWritingSampleDeps {
  writingConfigRepository: WritingConfigRepository;
}

export async function deleteWritingSample(
  deps: DeleteWritingSampleDeps,
  userId: string,
  sampleId: string,
  category: WritingCategory
): Promise<Result<void>> {
  const result = await deps.writingConfigRepository.deleteSample(userId, sampleId, category);

  if (!result.ok && result.error.message === 'Sample not found') {
    return { ok: false, error: new SampleNotFoundError() };
  }

  return result;
}
