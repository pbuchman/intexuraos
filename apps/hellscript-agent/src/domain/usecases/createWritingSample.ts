import type { Result } from '@intexuraos/common-core';
import type { WritingConfigRepository } from '../ports/writingConfigRepository.js';
import type { WritingCategory } from '../models/writingCategory.js';
import type { WritingSample } from '../models/writingSample.js';

const MAX_SAMPLES_PER_CATEGORY = 5;

export interface CreateWritingSampleDeps {
  writingConfigRepository: WritingConfigRepository;
}

export class MaxSamplesError extends Error {
  readonly code = 'MAX_SAMPLES' as const;
  constructor(max: number) {
    super(`Maximum ${String(max)} samples per category reached`);
    this.name = 'MaxSamplesError';
  }
}

export async function createWritingSample(
  deps: CreateWritingSampleDeps,
  userId: string,
  category: WritingCategory,
  title: string,
  text: string
): Promise<Result<WritingSample>> {
  const countResult = await deps.writingConfigRepository.countSamplesByCategory(userId, category);
  if (!countResult.ok) {
    return countResult;
  }

  if (countResult.value >= MAX_SAMPLES_PER_CATEGORY) {
    return {
      ok: false,
      error: new MaxSamplesError(MAX_SAMPLES_PER_CATEGORY),
    };
  }

  return await deps.writingConfigRepository.createSample(userId, {
    category,
    title,
    text,
  });
}
