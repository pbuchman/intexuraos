/**
 * Retry failed LLMs use case.
 * Re-runs only the failed LLM providers after user confirms 'retry'.
 * Max 2 retries allowed.
 */

import type { Result } from '@intexuraos/common-core';
import type { PublishError } from '@intexuraos/infra-pubsub';
import type { LlmProvider } from '../models/index.js';
import type { ResearchRepository } from '../ports/index.js';

const MAX_RETRIES = 2;

export interface LlmCallPublisher {
  publishLlmCall(event: {
    type: 'llm.call';
    researchId: string;
    userId: string;
    provider: LlmProvider;
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
  retriedProviders?: LlmProvider[];
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

  const failedProviders = research.partialFailure.failedProviders;

  for (const provider of failedProviders) {
    await researchRepo.updateLlmResult(researchId, provider, {
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

  for (const provider of failedProviders) {
    await llmCallPublisher.publishLlmCall({
      type: 'llm.call',
      researchId,
      userId: research.userId,
      provider,
      prompt: research.prompt,
    });
  }

  return { ok: true, retriedProviders: failedProviders };
}
