import type { Result } from '@intexuraos/common-core';
import type { WritingConfigRepository } from '../ports/writingConfigRepository.js';
import type { WritingCategory } from '../models/writingCategory.js';
import { escapeXmlTags } from '../services/sanitize.js';

export interface UpdateStyleInstructionsDeps {
  writingConfigRepository: WritingConfigRepository;
}

export async function updateStyleInstructions(
  deps: UpdateStyleInstructionsDeps,
  userId: string,
  category: WritingCategory,
  text: string
): Promise<Result<void>> {
  const sanitized = escapeXmlTags(text);
  return await deps.writingConfigRepository.upsertStyleInstructions(userId, category, sanitized);
}
