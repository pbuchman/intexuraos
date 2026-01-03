/**
 * Retry research use case.
 * Intelligently retries failed research by:
 * 1. Retrying only failed individual LLM calls
 * 2. Re-running synthesis if it failed or if results changed
 * 3. Completing research if everything already succeeded
 */

import type { Result } from '@intexuraos/common-core';
import type { PublishError } from '@intexuraos/infra-pubsub';
import type { LlmProvider } from '../models/index.js';
import type { ResearchRepository } from '../ports/index.js';
import type { RunSynthesisDeps } from './runSynthesis.js';
import { runSynthesis } from './runSynthesis.js';

export interface LlmCallPublisher {
  publishLlmCall(event: {
    type: 'llm.call';
    researchId: string;
    userId: string;
    provider: LlmProvider;
    prompt: string;
  }): Promise<Result<void, PublishError>>;
}

export interface RetryResearchDeps {
  researchRepo: ResearchRepository;
  llmCallPublisher: LlmCallPublisher;
  synthesisDeps: RunSynthesisDeps;
}

export type RetryAction =
  | 'retrying_llms'
  | 'synthesis_completed'
  | 'already_completed'
  | 'synthesis_skipped';

export interface RetryResult {
  ok: boolean;
  error?: string;
  action?: RetryAction;
  retriedProviders?: LlmProvider[];
  message?: string;
}

interface RetryAnalysis {
  failedLlms: LlmProvider[];
  successfulLlms: LlmProvider[];
  hasSynthesisResult: boolean;
  hasSynthesisError: boolean;
}

function analyzeResearchForRetry(research: {
  llmResults: Array<{ provider: LlmProvider; status: string }>;
  synthesizedResult?: string;
  synthesisError?: string;
  skipSynthesis?: boolean;
}): RetryAnalysis {
  const failedLlms: LlmProvider[] = [];
  const successfulLlms: LlmProvider[] = [];

  for (const llmResult of research.llmResults) {
    if (llmResult.status === 'failed') {
      failedLlms.push(llmResult.provider);
    } else if (llmResult.status === 'completed') {
      successfulLlms.push(llmResult.provider);
    }
  }

  return {
    failedLlms,
    successfulLlms,
    hasSynthesisResult: research.synthesizedResult !== undefined,
    hasSynthesisError: research.synthesisError !== undefined,
  };
}

export async function retryResearch(
  researchId: string,
  deps: RetryResearchDeps
): Promise<RetryResult> {
  const { researchRepo, llmCallPublisher, synthesisDeps } = deps;

  // 1. Load research
  const researchResult = await researchRepo.findById(researchId);
  if (!researchResult.ok || researchResult.value === null) {
    return { ok: false, error: 'Research not found' };
  }

  const research = researchResult.value;

  // 2. Validate status - can only retry failed research
  if (research.status !== 'failed') {
    return {
      ok: false,
      error: `Cannot retry research with status: ${research.status}. Only failed research can be retried.`,
    };
  }

  // 3. Analyze current state
  const analysis = analyzeResearchForRetry(research);

  // 4. If there are failed LLMs, retry them first
  if (analysis.failedLlms.length > 0) {
    // Mark research as retrying
    await researchRepo.update(researchId, {
      status: 'retrying',
    });

    // Reset failed LLM results to pending (clear error)
    for (const provider of analysis.failedLlms) {
      await researchRepo.updateLlmResult(researchId, provider, {
        status: 'pending',
        error: undefined,
        startedAt: undefined,
        completedAt: undefined,
        durationMs: undefined,
      });
    }

    // Publish LLM call events for retry
    for (const provider of analysis.failedLlms) {
      const publishResult = await llmCallPublisher.publishLlmCall({
        type: 'llm.call',
        researchId,
        userId: research.userId,
        provider,
        prompt: research.prompt,
      });

      if (!publishResult.ok) {
        // If publishing fails, mark LLM as failed immediately
        await researchRepo.updateLlmResult(researchId, provider, {
          status: 'failed',
          error: `Failed to publish retry event: ${publishResult.error.message}`,
        });
      }
    }

    return {
      ok: true,
      action: 'retrying_llms',
      retriedProviders: analysis.failedLlms,
      message: `Retrying ${analysis.failedLlms.length} failed LLM provider${analysis.failedLlms.length === 1 ? '' : 's'}`,
    };
  }

  // 5. No failed LLMs - check if we have any successful results
  if (analysis.successfulLlms.length === 0) {
    return {
      ok: false,
      error: 'No successful LLM results to work with. Cannot retry research.',
    };
  }

  // 6. Check if synthesis needs to be run
  const shouldSkipSynthesis = research.skipSynthesis === true;
  const needsSynthesis =
    !shouldSkipSynthesis && (!analysis.hasSynthesisResult || analysis.hasSynthesisError);

  if (needsSynthesis) {
    // Run synthesis
    const synthesisResult = await runSynthesis(researchId, synthesisDeps);

    if (synthesisResult.ok) {
      return {
        ok: true,
        action: 'synthesis_completed',
        message: 'Synthesis completed successfully',
      };
    } else {
      return {
        ok: false,
        error: synthesisResult.error ?? 'Synthesis failed',
      };
    }
  }

  // 7. Research was already completed (synthesis exists or was skipped)
  // Just update status to completed
  const now = new Date();
  const startedAt = new Date(research.startedAt);
  const totalDurationMs = now.getTime() - startedAt.getTime();

  await researchRepo.update(researchId, {
    status: 'completed',
    completedAt: now.toISOString(),
    totalDurationMs,
    synthesisError: undefined, // Clear any old error
  });

  if (shouldSkipSynthesis) {
    return {
      ok: true,
      action: 'synthesis_skipped',
      message: 'Research completed (synthesis skipped)',
    };
  }

  return {
    ok: true,
    action: 'already_completed',
    message: 'Research was already completed',
  };
}
