/**
 * Submit research usecase.
 * Creates a new research record for async processing.
 */

import type { Result } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import { createResearch, type Research, type ResearchModel } from '../models/index.js';
import type { RepositoryError, ResearchRepository } from '../ports/index.js';

export interface SubmitResearchParams {
  userId: string;
  prompt: string;
  /** Original user prompt before improvement. Set when user accepted an improved suggestion. */
  originalPrompt?: string;
  selectedModels: ResearchModel[];
  synthesisModel: ResearchModel;
  inputContexts?: { content: string; label?: string | undefined }[];
  skipSynthesis?: boolean;
}

export interface SubmitResearchDeps {
  researchRepo: ResearchRepository;
  generateId: () => string;
  logger: Logger;
}

export async function submitResearch(
  params: SubmitResearchParams,
  deps: SubmitResearchDeps
): Promise<Result<Research, RepositoryError>> {
  const { researchRepo, generateId, logger } = deps;

  const createParams: Parameters<typeof createResearch>[0] = {
    id: generateId(),
    userId: params.userId,
    prompt: params.prompt,
    selectedModels: params.selectedModels,
    synthesisModel: params.synthesisModel,
  };
  if (params.originalPrompt !== undefined) {
    createParams.originalPrompt = params.originalPrompt;
  }
  if (params.inputContexts !== undefined) {
    createParams.inputContexts = params.inputContexts;
  }
  if (params.skipSynthesis === true) {
    createParams.skipSynthesis = true;
  }

  logger.info(
    {
      researchId: createParams.id,
      userId: params.userId,
      modelCount: params.selectedModels.length,
      synthesisModel: params.synthesisModel,
      hasContexts: params.inputContexts !== undefined && params.inputContexts.length > 0,
      skipSynthesis: params.skipSynthesis === true,
    },
    'Creating research submission'
  );

  const research = createResearch(createParams);

  const result = await researchRepo.save(research);

  if (result.ok) {
    logger.info(
      {
        researchId: research.id,
        userId: params.userId,
        status: research.status,
      },
      'Research submission saved successfully'
    );
  } else {
    logger.error(
      {
        researchId: research.id,
        userId: params.userId,
        error: result.error.message,
      },
      'Failed to save research submission'
    );
  }

  return result;
}
