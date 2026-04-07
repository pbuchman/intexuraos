import type { Result } from '@intexuraos/common-core';
import type { WritingConfigRepository } from '../ports/writingConfigRepository.js';
import type { WritingStyleConfig } from '../models/writingStyleConfig.js';

export interface GetWritingConfigDeps {
  writingConfigRepository: WritingConfigRepository;
}

export async function getWritingConfig(
  deps: GetWritingConfigDeps,
  userId: string
): Promise<Result<WritingStyleConfig | null>> {
  return await deps.writingConfigRepository.getStyleConfig(userId);
}
