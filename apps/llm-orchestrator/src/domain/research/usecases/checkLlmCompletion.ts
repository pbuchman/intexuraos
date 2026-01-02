/**
 * Check LLM completion use case.
 * Called after each LLM result is stored to detect when all LLMs are done.
 * Triggers synthesis or partial failure handling based on results.
 */

import type { LlmProvider } from '../models/index.js';
import type { ResearchRepository } from '../ports/index.js';

export type CompletionAction =
  | { type: 'pending' }
  | { type: 'all_completed' }
  | { type: 'all_failed' }
  | { type: 'partial_failure'; failedProviders: LlmProvider[] };

export interface CheckLlmCompletionDeps {
  researchRepo: ResearchRepository;
}

export async function checkLlmCompletion(
  researchId: string,
  deps: CheckLlmCompletionDeps
): Promise<CompletionAction> {
  const { researchRepo } = deps;

  const researchResult = await researchRepo.findById(researchId);
  if (!researchResult.ok || researchResult.value === null) {
    return { type: 'pending' };
  }

  const research = researchResult.value;
  const selectedProviders = new Set(research.selectedLlms);
  const results = research.llmResults.filter((r) => selectedProviders.has(r.provider));

  const completed = results.filter((r) => r.status === 'completed');
  const failed = results.filter((r) => r.status === 'failed');
  const pending = results.filter((r) => r.status === 'pending' || r.status === 'processing');

  if (pending.length > 0) {
    return { type: 'pending' };
  }

  if (completed.length === 0) {
    await researchRepo.update(researchId, {
      status: 'failed',
      synthesisError: 'All LLM calls failed',
      completedAt: new Date().toISOString(),
    });
    return { type: 'all_failed' };
  }

  if (failed.length === 0) {
    return { type: 'all_completed' };
  }

  const failedProviders = failed.map((r) => r.provider);
  const retryCount = research.partialFailure?.retryCount ?? 0;

  await researchRepo.update(researchId, {
    status: 'awaiting_confirmation',
    partialFailure: {
      failedProviders,
      detectedAt: new Date().toISOString(),
      retryCount,
    },
  });

  return { type: 'partial_failure', failedProviders };
}
