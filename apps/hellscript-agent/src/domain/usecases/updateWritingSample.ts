import type { Result } from '@intexuraos/common-core';
import type { WritingConfigRepository } from '../ports/writingConfigRepository.js';
import type { WritingCategory } from '../models/writingCategory.js';
import { escapeXmlTags } from '../services/sanitize.js';

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
  const sanitizedTitle = escapeXmlTags(title);
  const sanitizedText = escapeXmlTags(text);
  return await deps.writingConfigRepository.updateSample(
    userId,
    sampleId,
    category,
    sanitizedTitle,
    sanitizedText
  );
}
