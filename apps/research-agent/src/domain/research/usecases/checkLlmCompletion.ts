/**
 * Check LLM completion use case.
 * Called after each LLM result is stored to detect when all LLMs are done.
 * Triggers synthesis or partial failure handling based on results.
 */

import type { ResearchModel } from '../models/index.js';
<<<<<<< HEAD
=======
import type { Logger } from 'pino';
>>>>>>> origin/development
import type { ResearchRepository } from '../ports/index.js';

export type CompletionAction =
  | { type: 'pending' }
  | { type: 'all_completed' }
  | { type: 'all_failed' }
  | { type: 'partial_failure'; failedModels: ResearchModel[] };

export interface CheckLlmCompletionDeps {
  researchRepo: ResearchRepository;
  logger: Logger;
}

export async function checkLlmCompletion(
  researchId: string,
  deps: CheckLlmCompletionDeps
): Promise<CompletionAction> {
  const { researchRepo, logger } = deps;

  const researchResult = await researchRepo.findById(researchId);
  if (!researchResult.ok || researchResult.value === null) {
    logger.warn({ researchId }, 'Research not found for completion check');
    return { type: 'pending' };
  }

  const research = researchResult.value;
  const selectedModels = new Set(research.selectedModels);
  const results = research.llmResults.filter((r) => selectedModels.has(r.model as ResearchModel));

  const completed = results.filter((r) => r.status === 'completed');
  const failed = results.filter((r) => r.status === 'failed');
  const pending = results.filter((r) => r.status === 'pending' || r.status === 'processing');

  logger.info(
    {
      researchId,
      completed: completed.length,
      failed: failed.length,
      pending: pending.length,
      total: results.length,
    },
    'Checking LLM completion status'
  );

  if (pending.length > 0) {
    return { type: 'pending' };
  }

  if (completed.length === 0) {
    logger.info(
      {
        researchId,
        failedModels: failed.map((r) => r.model),
      },
      'All LLMs failed, transitioning to all_failed state'
    );
    await researchRepo.update(researchId, {
      status: 'failed',
      synthesisError: 'All LLM calls failed',
      completedAt: new Date().toISOString(),
    });
    return { type: 'all_failed' };
  }

  if (failed.length === 0) {
    logger.info(
      {
        researchId,
        completedModels: completed.map((r) => r.model),
      },
      'All LLMs completed successfully'
    );
    return { type: 'all_completed' };
  }

  const failedModels = failed.map((r) => r.model as ResearchModel);
  const retryCount = research.partialFailure?.retryCount ?? 0;

  logger.info(
    {
      researchId,
      failedModels,
      completedModels: completed.map((r) => r.model),
      retryCount,
    },
    'Partial failure detected, transitioning to awaiting_confirmation'
  );

  await researchRepo.update(researchId, {
    status: 'awaiting_confirmation',
    partialFailure: {
      failedModels,
      detectedAt: new Date().toISOString(),
      retryCount,
    },
  });

  return { type: 'partial_failure', failedModels };
}
