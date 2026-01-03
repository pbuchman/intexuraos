/**
 * Process research usecase.
 * Dispatches LLM calls to Pub/Sub for parallel processing in separate Cloud Run instances.
 */

import type { Result } from '@intexuraos/common-core';
import type { PublishError } from '@intexuraos/infra-pubsub';
import type { SupportedModel } from '../models/index.js';
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
    model: SupportedModel;
    prompt: string;
  }): Promise<Result<void, PublishError>>;
}

export interface ProcessResearchDeps {
  researchRepo: ResearchRepository;
  llmCallPublisher: LlmCallPublisher;
  logger: MinimalLogger;
  titleGenerator?: TitleGenerator;
  synthesizer?: LlmSynthesisProvider;
  reportLlmSuccess?: (model: SupportedModel) => void;
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
  const titleModel: SupportedModel =
    deps.titleGenerator !== undefined ? 'gemini-2.5-flash' : research.synthesisModel;
  if (titleGen !== undefined) {
    const titleResult = await titleGen.generateTitle(research.prompt);
    if (titleResult.ok) {
      await deps.researchRepo.update(researchId, { title: titleResult.value });
      deps.logger.info({ researchId, model: titleModel }, 'Title generated successfully');
      if (deps.reportLlmSuccess !== undefined) {
        deps.reportLlmSuccess(titleModel);
      }
    } else {
      deps.logger.warn(
        { researchId, model: titleModel, error: titleResult.error },
        'Title generation failed, using default title'
      );
    }
  } else {
    deps.logger.debug({ researchId }, 'Title generation skipped, no generator available');
  }

  // Dispatch LLM calls to Pub/Sub (runs in separate Cloud Run instances)
  // Skip models that already have completed results (for enhanced researches)
  const pendingModels = research.llmResults
    .filter((r) => r.status === 'pending')
    .map((r) => r.model as SupportedModel);

  deps.logger.info(
    {
      researchId,
      totalModels: research.selectedModels.length,
      pendingModels: pendingModels.length,
    },
    'Dispatching LLM calls'
  );

  for (const model of pendingModels) {
    await deps.llmCallPublisher.publishLlmCall({
      type: 'llm.call',
      researchId,
      userId: research.userId,
      model,
      prompt: research.prompt,
    });
  }

  // If no pending models (enhanced research with all pre-completed results),
  // trigger synthesis immediately
  if (pendingModels.length === 0) {
    deps.logger.info({ researchId }, 'All LLM results already completed, triggering synthesis');
    return { triggerSynthesis: true };
  }

  return { triggerSynthesis: false };
}
