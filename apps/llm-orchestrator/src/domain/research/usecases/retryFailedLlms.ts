/**
 * Retry failed LLMs use case.
 * Re-runs only the failed LLM models after user confirms 'retry'.
 * Max 2 retries allowed.
 */

import type { Result } from '@intexuraos/common-core';
import type { PublishError } from '@intexuraos/infra-pubsub';
import type { ResearchModel } from '../models/index.js';
import type { ResearchRepository } from '../ports/index.js';

const MAX_RETRIES = 2;

export interface LlmCallPublisher {
  publishLlmCall(event: {
    type: 'llm.call';
    researchId: string;
    userId: string;
    model: ResearchModel;
    prompt: string;
  }): Promise<Result<void, PublishError>>;
}

export interface RetryFailedLlmsDeps {
  researchRepo: ResearchRepository;
  llmCallPublisher: LlmCallPublisher;
}

export interface RetryResult {
  ok: boolean;
  error?: string;
  retriedModels?: ResearchModel[];
}

export async function retryFailedLlms(
  researchId: string,
  deps: RetryFailedLlmsDeps
): Promise<RetryResult> {
  const { researchRepo, llmCallPublisher } = deps;

  const researchResult = await researchRepo.findById(researchId);
  if (!researchResult.ok || researchResult.value === null) {
    return { ok: false, error: 'Research not found' };
  }

  const research = researchResult.value;

  if (research.status !== 'awaiting_confirmation') {
    return { ok: false, error: `Invalid status for retry: ${research.status}` };
  }

  if (research.partialFailure === undefined) {
    return { ok: false, error: 'No partial failure info found' };
  }

  const currentRetryCount = research.partialFailure.retryCount;
  if (currentRetryCount >= MAX_RETRIES) {
    await researchRepo.update(researchId, {
      status: 'failed',
      synthesisError: 'Maximum retry attempts exceeded',
      completedAt: new Date().toISOString(),
    });
    return { ok: false, error: 'Maximum retry attempts exceeded' };
  }

  const failedModels = research.partialFailure.failedModels;

  for (const model of failedModels) {
    await researchRepo.updateLlmResult(researchId, model, {
      status: 'pending',
    });
  }

  await researchRepo.update(researchId, {
    status: 'retrying',
    partialFailure: {
      ...research.partialFailure,
      retryCount: currentRetryCount + 1,
      userDecision: 'retry',
    },
  });

  for (const model of failedModels) {
    await llmCallPublisher.publishLlmCall({
      type: 'llm.call',
      researchId,
      userId: research.userId,
      model,
      prompt: research.prompt,
    });
  }

  return { ok: true, retriedModels: failedModels };
}
