import type { Logger } from '@intexuraos/common-core';
import type { Result } from '@intexuraos/common-core';
import type { UsageEvent } from '../models/usageEvent.js';
import type { UsageEventRepository } from '../repositories/usageEventRepository.js';

export interface GetUsageEventDeps {
  logger: Logger;
  usageEventRepository: UsageEventRepository;
}

export async function getUsageEvent(
  deps: GetUsageEventDeps,
  eventId: string,
): Promise<Result<UsageEvent | null, { code: string; message: string }>> {
  const { logger, usageEventRepository } = deps;

  const result = await usageEventRepository.getById(eventId);

  if (!result.ok) {
    logger.error({ eventId, error: result.error }, 'Failed to fetch usage event');
    return result;
  }

  if (result.value !== null) {
    logger.info({ eventId }, 'Usage event retrieved');
  }

  return result;
}
