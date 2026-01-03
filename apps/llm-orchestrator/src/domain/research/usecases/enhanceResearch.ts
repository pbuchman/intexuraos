/**
 * Enhance research usecase.
 * Creates a new research based on a completed one, reusing successful LLM results.
 */

import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import {
  createEnhancedResearch,
  type Research,
  type SupportedModel,
} from '../models/index.js';
import type { RepositoryError, ResearchRepository } from '../ports/index.js';

export interface EnhanceResearchInput {
  sourceResearchId: string;
  userId: string;
  additionalModels?: SupportedModel[];
  additionalContexts?: { content: string; model?: string }[];
  synthesisModel?: SupportedModel;
  removeContextIds?: string[];
}

export interface EnhanceResearchDeps {
  researchRepo: ResearchRepository;
  generateId: () => string;
}

export type EnhanceResearchError =
  | { type: 'NOT_FOUND' }
  | { type: 'FORBIDDEN' }
  | { type: 'INVALID_STATUS'; status: string }
  | { type: 'NO_CHANGES' }
  | { type: 'REPO_ERROR'; error: RepositoryError };

export async function enhanceResearch(
  params: EnhanceResearchInput,
  deps: EnhanceResearchDeps
): Promise<Result<Research, EnhanceResearchError>> {
  const sourceResult = await deps.researchRepo.findById(params.sourceResearchId);
  if (!sourceResult.ok) {
    return err({ type: 'REPO_ERROR', error: sourceResult.error });
  }

  if (sourceResult.value === null) {
    return err({ type: 'NOT_FOUND' });
  }

  const source = sourceResult.value;

  if (source.userId !== params.userId) {
    return err({ type: 'FORBIDDEN' });
  }

  if (source.status !== 'completed') {
    return err({ type: 'INVALID_STATUS', status: source.status });
  }

  const hasNewModels = (params.additionalModels?.length ?? 0) > 0;
  const hasNewContexts = (params.additionalContexts?.length ?? 0) > 0;
  const hasRemovedContexts = (params.removeContextIds?.length ?? 0) > 0;
  const hasSynthesisChange = params.synthesisModel !== undefined;

  if (!hasNewModels && !hasNewContexts && !hasRemovedContexts && !hasSynthesisChange) {
    return err({ type: 'NO_CHANGES' });
  }

  const enhanceParams: Parameters<typeof createEnhancedResearch>[0] = {
    id: deps.generateId(),
    userId: params.userId,
    sourceResearch: source,
  };
  if (params.additionalModels !== undefined) {
    enhanceParams.additionalModels = params.additionalModels;
  }
  if (params.additionalContexts !== undefined) {
    enhanceParams.additionalContexts = params.additionalContexts;
  }
  if (params.synthesisModel !== undefined) {
    enhanceParams.synthesisModel = params.synthesisModel;
  }
  if (params.removeContextIds !== undefined) {
    enhanceParams.removeContextIds = params.removeContextIds;
  }
  const enhanced = createEnhancedResearch(enhanceParams);

  const saveResult = await deps.researchRepo.save(enhanced);
  if (!saveResult.ok) {
    return err({ type: 'REPO_ERROR', error: saveResult.error });
  }

  return ok(saveResult.value);
}
