/**
 * Process research usecase.
 * Dispatches LLM calls to Pub/Sub for parallel processing in separate Cloud Run instances.
 */

import type { Result } from '@intexuraos/common-core';
import type { PublishError } from '@intexuraos/infra-pubsub';
import type { SupportedModel } from '../models/index.js';
import type { LlmSynthesisProvider, ResearchRepository, TitleGenerator } from '../ports/index.js';
import type { ContextInferenceProvider } from '../ports/contextInference.js';

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
  contextInferrer?: ContextInferenceProvider;
  reportLlmSuccess?: (model: SupportedModel) => void;
}

export interface ProcessResearchResult {
  triggerSynthesis: boolean;
}

export async function processResearch(
  researchId: string,
  deps: ProcessResearchDeps
): Promise<ProcessResearchResult> {
  deps.logger.info({ researchId }, '[2.1] Loading research from database');
  const researchResult = await deps.researchRepo.findById(researchId);
  if (!researchResult.ok || researchResult.value === null) {
    deps.logger.warn({ researchId }, '[2.1] Research not found');
    return { triggerSynthesis: false };
  }

  const research = researchResult.value;

  deps.logger.info({ researchId }, '[2.2] Updating status to processing');
  await deps.researchRepo.update(researchId, {
    status: 'processing',
    startedAt: new Date().toISOString(),
  });

  const titleGen = deps.titleGenerator ?? deps.synthesizer;
  const titleModel: SupportedModel =
    deps.titleGenerator !== undefined ? 'gemini-2.5-flash' : research.synthesisModel;
  if (titleGen !== undefined) {
    deps.logger.info({ researchId, model: titleModel }, '[2.3.1] Starting title generation');
    const titleResult = await titleGen.generateTitle(research.prompt);
    if (titleResult.ok) {
      await deps.researchRepo.update(researchId, { title: titleResult.value });
      deps.logger.info({ researchId, model: titleModel }, '[2.3.2] Title generated successfully');
      if (deps.reportLlmSuccess !== undefined) {
        deps.reportLlmSuccess(titleModel);
      }
    } else {
      deps.logger.warn(
        { researchId, model: titleModel, error: titleResult.error },
        '[2.3.2] Title generation failed, using default title'
      );
    }
  } else {
    deps.logger.debug({ researchId }, '[2.3] Title generation skipped (no generator available)');
  }

  if (deps.contextInferrer !== undefined) {
    deps.logger.info({ researchId }, '[2.4.1] Starting research context inference');
    const contextResult = await deps.contextInferrer.inferResearchContext(research.prompt);
    if (contextResult.ok) {
      await deps.researchRepo.update(researchId, { researchContext: contextResult.value });
      deps.logger.info(
        { researchId, domain: contextResult.value.domain },
        '[2.4.2] Research context inferred successfully'
      );
      if (deps.reportLlmSuccess !== undefined) {
        deps.reportLlmSuccess('gemini-2.5-flash');
      }
    } else {
      deps.logger.warn(
        { researchId, error: contextResult.error },
        '[2.4.2] Context inference failed, proceeding without context'
      );
    }
  }

  const pendingModels = research.llmResults
    .filter((r) => r.status === 'pending')
    .map((r) => r.model as SupportedModel);

  deps.logger.info(
    {
      researchId,
      totalModels: research.selectedModels.length,
      pendingModels: pendingModels.length,
    },
    '[2.5.1] Preparing to dispatch LLM calls'
  );

  for (let i = 0; i < pendingModels.length; i++) {
    const model = pendingModels[i];
    if (model !== undefined) {
      deps.logger.info(
        { researchId, model, index: i + 1, total: pendingModels.length },
        `[2.5.2] Publishing LLM call to Pub/Sub`
      );
      await deps.llmCallPublisher.publishLlmCall({
        type: 'llm.call',
        researchId,
        userId: research.userId,
        model,
        prompt: research.prompt,
      });
    }
  }

  if (pendingModels.length === 0) {
    deps.logger.info(
      { researchId },
      '[2.5.3] All LLM results already completed, triggering synthesis'
    );
    return { triggerSynthesis: true };
  }

  deps.logger.info(
    { researchId, dispatchedCount: pendingModels.length },
    '[2.5.3] LLM calls dispatched, awaiting results'
  );
  return { triggerSynthesis: false };
}
