/**
 * Process research usecase.
 * Dispatches LLM calls to Pub/Sub for parallel processing in separate Cloud Run instances.
 */

import type { Result } from '@intexuraos/common-core';
import type { PublishError } from '@intexuraos/infra-pubsub';
import type { LlmProvider } from '../models/index.js';
import type { LlmSynthesisProvider, ResearchRepository, TitleGenerator } from '../ports/index.js';

interface MinimalLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  debug(obj: object, msg: string): void;
}

export interface LlmCallPublisher {
  publishLlmCall(event: {
    type: 'llm.call';
    researchId: string;
    userId: string;
    provider: LlmProvider;
    prompt: string;
  }): Promise<Result<void, PublishError>>;
}

export interface ProcessResearchDeps {
  researchRepo: ResearchRepository;
  llmCallPublisher: LlmCallPublisher;
  logger: MinimalLogger;
  titleGenerator?: TitleGenerator;
  synthesizer?: LlmSynthesisProvider;
  reportLlmSuccess?: (provider: LlmProvider) => void;
}

export interface ProcessResearchResult {
  triggerSynthesis: boolean;
}

export async function processResearch(
  researchId: string,
  deps: ProcessResearchDeps
): Promise<ProcessResearchResult> {
  const researchResult = await deps.researchRepo.findById(researchId);
  if (!researchResult.ok || researchResult.value === null) {
    return { triggerSynthesis: false };
  }

  const research = researchResult.value;

  // Update status to processing and reset startedAt to now
  await deps.researchRepo.update(researchId, {
    status: 'processing',
    startedAt: new Date().toISOString(),
  });

  // Generate title (use dedicated titleGenerator if available, else fall back to synthesizer)
  const titleGen = deps.titleGenerator ?? deps.synthesizer;
  const titleSource = deps.titleGenerator !== undefined ? 'google' : research.synthesisLlm;
  if (titleGen !== undefined) {
    const titleResult = await titleGen.generateTitle(research.prompt);
    if (titleResult.ok) {
      await deps.researchRepo.update(researchId, { title: titleResult.value });
      deps.logger.info({ researchId, provider: titleSource }, 'Title generated successfully');
      if (deps.reportLlmSuccess !== undefined) {
        deps.reportLlmSuccess(titleSource);
      }
    } else {
      deps.logger.warn(
        { researchId, provider: titleSource, error: titleResult.error },
        'Title generation failed, using default title'
      );
    }
  } else {
    deps.logger.debug({ researchId }, 'Title generation skipped, no generator available');
  }

  // Dispatch LLM calls to Pub/Sub (runs in separate Cloud Run instances)
  // Skip providers that already have completed results (for enhanced researches)
  const pendingProviders = research.llmResults
    .filter((r) => r.status === 'pending')
    .map((r) => r.provider);

  deps.logger.info(
    {
      researchId,
      totalProviders: research.selectedLlms.length,
      pendingProviders: pendingProviders.length,
    },
    'Dispatching LLM calls'
  );

  for (const provider of pendingProviders) {
    await deps.llmCallPublisher.publishLlmCall({
      type: 'llm.call',
      researchId,
      userId: research.userId,
      provider,
      prompt: research.prompt,
    });
  }

  // If no pending providers (enhanced research with all pre-completed results),
  // trigger synthesis immediately
  if (pendingProviders.length === 0) {
    deps.logger.info({ researchId }, 'All LLM results already completed, triggering synthesis');
    return { triggerSynthesis: true };
  }

  return { triggerSynthesis: false };
}
