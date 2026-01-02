/**
 * Process research usecase.
 * Dispatches LLM calls to Pub/Sub for parallel processing in separate Cloud Run instances.
 */

import type { Result } from '@intexuraos/common-core';
import type { PublishError } from '@intexuraos/infra-pubsub';
import type { LlmProvider } from '../models/index.js';
import type { LlmSynthesisProvider, ResearchRepository, TitleGenerator } from '../ports/index.js';

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
  titleGenerator?: TitleGenerator;
  synthesizer?: LlmSynthesisProvider;
  reportLlmSuccess?: (provider: LlmProvider) => void;
}

export async function processResearch(
  researchId: string,
  deps: ProcessResearchDeps
): Promise<void> {
  const researchResult = await deps.researchRepo.findById(researchId);
  if (!researchResult.ok || researchResult.value === null) {
    return;
  }

  const research = researchResult.value;

  // Update status to processing
  await deps.researchRepo.update(researchId, { status: 'processing' });

  // Generate title (use dedicated titleGenerator if available, else fall back to synthesizer)
  const titleGen = deps.titleGenerator ?? deps.synthesizer;
  if (titleGen !== undefined) {
    const titleResult = await titleGen.generateTitle(research.prompt);
    if (titleResult.ok) {
      await deps.researchRepo.update(researchId, { title: titleResult.value });
      if (deps.reportLlmSuccess !== undefined) {
        const titleProvider = deps.titleGenerator !== undefined ? 'google' : research.synthesisLlm;
        deps.reportLlmSuccess(titleProvider);
      }
    }
  }

  // Dispatch LLM calls to Pub/Sub (runs in separate Cloud Run instances)
  for (const provider of research.selectedLlms) {
    await deps.llmCallPublisher.publishLlmCall({
      type: 'llm.call',
      researchId,
      userId: research.userId,
      provider,
      prompt: research.prompt,
    });
  }
}
