import { ok, err, type Result } from '@intexuraos/common-core';
import type { CodeTask } from '../../models/codeTask.js';
import type { CodeTaskRepository } from '../../repositories/codeTaskRepository.js';

export interface FetchBacklogDeps {
  codeTaskRepo: Pick<CodeTaskRepository, 'listPendingExecutionMemoryPostRun'>;
  limit: number;
}

export async function fetchBacklog(
  deps: FetchBacklogDeps
): Promise<Result<CodeTask[], { code: 'internal_error'; message: string }>> {
  const pendingResult = await deps.codeTaskRepo.listPendingExecutionMemoryPostRun(deps.limit);
  if (!pendingResult.ok) {
    return err({ code: 'internal_error', message: pendingResult.error.message });
  }
  return ok(pendingResult.value);
}
