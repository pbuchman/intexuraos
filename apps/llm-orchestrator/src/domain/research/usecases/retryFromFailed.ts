/**
 * Retry from failed status use case.
 * Allows users to retry a failed research by re-running failed LLMs or synthesis.
 * Idempotent: if nothing to retry, marks as completed.
 */

import type { Result } from '@intexuraos/common-core';
import type { PublishError } from '@intexuraos/infra-pubsub';
import type { ResearchModel } from '../models/index.js';
import type { ResearchRepository } from '../ports/index.js';
import type { RunSynthesisDeps } from './runSynthesis.js';
import { runSynthesis } from './runSynthesis.js';

export interface LlmCallPublisher {
  publishLlmCall(event: {
    type: 'llm.call';
    researchId: string;
    userId: string;
    model: ResearchModel;
    prompt: string;
  }): Promise<Result<void, PublishError>>;
}

export interface RetryFromFailedDeps {
  researchRepo: ResearchRepository;
  llmCallPublisher: LlmCallPublisher;
  synthesisDeps: Omit<RunSynthesisDeps, 'researchRepo'>;
}

export type RetryAction = 'retried_llms' | 'retried_synthesis' | 'already_completed';

export interface RetryFromFailedResult {
  ok: boolean;
  error?: string;
  action?: RetryAction;
  retriedModels?: ResearchModel[];
}

export async function retryFromFailed(
  researchId: string,
  deps: RetryFromFailedDeps
): Promise<RetryFromFailedResult> {
  const { researchRepo, llmCallPublisher, synthesisDeps } = deps;

  const researchResult = await researchRepo.findById(researchId);
  if (!researchResult.ok || researchResult.value === null) {
    return { ok: false, error: 'Research not found' };
  }

  const research = researchResult.value;

  if (research.status === 'completed') {
    return { ok: true, action: 'already_completed' };
  }

  if (research.status !== 'failed') {
    return { ok: false, error: `Cannot retry from status: ${research.status}` };
  }

  const failedLlms = research.llmResults.filter((r) => r.status === 'failed');
  const hasFailedLlms = failedLlms.length > 0;
  const hasSynthesisError = research.synthesisError !== undefined && research.synthesisError !== '';
  const hasSuccessfulLlms = research.llmResults.some((r) => r.status === 'completed');

  if (hasFailedLlms) {
    const failedModels = failedLlms.map((r) => r.model) as ResearchModel[];

    for (const model of failedModels) {
      await researchRepo.updateLlmResult(researchId, model, {
        status: 'pending',
      });
    }

    await researchRepo.update(researchId, {
      status: 'retrying',
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

    return { ok: true, action: 'retried_llms', retriedModels: failedModels };
  }

  if (hasSynthesisError && hasSuccessfulLlms) {
    const synthesisResult = await runSynthesis(researchId, {
      researchRepo,
      ...synthesisDeps,
    });

    if (!synthesisResult.ok) {
      return { ok: false, error: synthesisResult.error ?? 'Synthesis failed' };
    }

    return { ok: true, action: 'retried_synthesis' };
  }

  const now = new Date();
  const startedAt = new Date(research.startedAt);
  const totalDurationMs = now.getTime() - startedAt.getTime();

  await researchRepo.update(researchId, {
    status: 'completed',
    completedAt: now.toISOString(),
    totalDurationMs,
  });

  return { ok: true, action: 'already_completed' };
}
