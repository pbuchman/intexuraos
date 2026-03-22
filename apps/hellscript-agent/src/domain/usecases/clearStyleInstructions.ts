import type { Result } from '@intexuraos/common-core';
import type { WritingConfigRepository } from '../ports/writingConfigRepository.js';
import type { WritingCategory } from '../models/writingCategory.js';

export interface ClearStyleInstructionsDeps {
  writingConfigRepository: WritingConfigRepository;
}

export async function clearStyleInstructions(
  deps: ClearStyleInstructionsDeps,
  userId: string,
  category: WritingCategory
): Promise<Result<void>> {
  return await deps.writingConfigRepository.deleteStyleInstructions(userId, category);
}
