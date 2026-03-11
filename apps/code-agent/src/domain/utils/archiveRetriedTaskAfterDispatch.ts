import type { Logger } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';

export interface ArchiveRetriedTaskAfterDispatchInput {
  logger: Logger;
  codeTaskRepo: CodeTaskRepository;
  retriedFrom?: string;
  retryTaskId: string;
  warningMessage: string;
}

export async function archiveRetriedTaskAfterDispatch(
  input: ArchiveRetriedTaskAfterDispatchInput
): Promise<void> {
  if (input.retriedFrom === undefined) {
    return;
  }

  const archiveResult = await input.codeTaskRepo.update(input.retriedFrom, {
    status: 'archived',
  });
  if (!archiveResult.ok) {
    input.logger.warn(
      {
        originalTaskId: input.retriedFrom,
        retryTaskId: input.retryTaskId,
        error: archiveResult.error,
      },
      input.warningMessage
    );
  }
}
