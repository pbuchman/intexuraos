import type { Result } from '@intexuraos/common-core';
import type { WritingConfigRepository } from '../ports/writingConfigRepository.js';
import type { WritingCategory } from '../models/writingCategory.js';

export interface UpdateWritingSampleDeps {
  writingConfigRepository: WritingConfigRepository;
}

export class SampleNotFoundError extends Error {
  readonly code = 'SAMPLE_NOT_FOUND' as const;
  constructor() {
    super('Sample not found');
    this.name = 'SampleNotFoundError';
  }
}

export async function updateWritingSample(
  deps: UpdateWritingSampleDeps,
  userId: string,
  sampleId: string,
  category: WritingCategory,
  title: string,
  text: string
): Promise<Result<void>> {
  const result = await deps.writingConfigRepository.updateSample(
    userId,
    sampleId,
    category,
    title,
    text
  );

  if (!result.ok && result.error.message === 'Sample not found') {
    return { ok: false, error: new SampleNotFoundError() };
  }

  return result;
}
