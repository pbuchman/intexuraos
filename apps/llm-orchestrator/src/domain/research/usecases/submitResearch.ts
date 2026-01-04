/**
 * Submit research usecase.
 * Creates a new research record for async processing.
 */

import type { Result } from '@intexuraos/common-core';
import { createResearch, type Research, type SupportedModel } from '../models/index.js';
import type { RepositoryError, ResearchRepository } from '../ports/index.js';

export interface SubmitResearchParams {
  userId: string;
  prompt: string;
  selectedModels: SupportedModel[];
  synthesisModel: SupportedModel;
  inputContexts?: { content: string; label?: string }[];
  skipSynthesis?: boolean;
}

export interface SubmitResearchDeps {
  researchRepo: ResearchRepository;
  generateId: () => string;
}

export async function submitResearch(
  params: SubmitResearchParams,
  deps: SubmitResearchDeps
): Promise<Result<Research, RepositoryError>> {
  const createParams: Parameters<typeof createResearch>[0] = {
    id: deps.generateId(),
    userId: params.userId,
    prompt: params.prompt,
    selectedModels: params.selectedModels,
    synthesisModel: params.synthesisModel,
  };
  if (params.inputContexts !== undefined) {
    createParams.inputContexts = params.inputContexts;
  }
  if (params.skipSynthesis === true) {
    createParams.skipSynthesis = true;
  }
  const research = createResearch(createParams);

  return await deps.researchRepo.save(research);
}
