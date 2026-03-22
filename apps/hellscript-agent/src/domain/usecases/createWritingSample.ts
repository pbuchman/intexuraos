import type { Result } from '@intexuraos/common-core';
import type { WritingConfigRepository } from '../ports/writingConfigRepository.js';
import type { WritingCategory } from '../models/writingCategory.js';
import type { WritingSample } from '../models/writingSample.js';
import { escapeXmlTags } from '../services/sanitize.js';

const MAX_SAMPLES_PER_CATEGORY = 5;

export interface CreateWritingSampleDeps {
  writingConfigRepository: WritingConfigRepository;
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
      error: new Error(`Maximum ${String(MAX_SAMPLES_PER_CATEGORY)} samples per category reached`),
    };
  }

  const sanitizedTitle = escapeXmlTags(title);
  const sanitizedText = escapeXmlTags(text);

  return await deps.writingConfigRepository.createSample(userId, {
    category,
    title: sanitizedTitle,
    text: sanitizedText,
  });
}
