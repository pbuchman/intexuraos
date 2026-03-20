import type { Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { HellscriptRepository } from '../ports/hellscriptRepository.js';
import type { HellscriptBuffer } from '../models/hellscriptBuffer.js';

export interface ListBuffersDeps {
  repository: HellscriptRepository;
  logger: Logger;
}

export async function listBuffers(
  deps: ListBuffersDeps,
  userId: string
): Promise<Result<HellscriptBuffer[]>> {
  deps.logger.info({ userId }, 'Listing buffers');
  return await deps.repository.listBuffers(userId);
}
