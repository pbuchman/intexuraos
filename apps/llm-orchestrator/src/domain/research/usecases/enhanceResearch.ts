/**
 * Enhance research usecase.
 * Creates a new research based on a completed one, reusing successful LLM results.
 */

import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import {
  createEnhancedResearch,
  type LlmProvider,
  type Research,
  type SearchMode,
} from '../models/index.js';
import type { RepositoryError, ResearchRepository } from '../ports/index.js';

export interface EnhanceResearchInput {
  sourceResearchId: string;
  userId: string;
  additionalLlms?: LlmProvider[];
  additionalContexts?: { content: string; model?: string }[];
  synthesisLlm?: LlmProvider;
  removeContextIds?: string[];
  searchMode?: SearchMode;
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

  const hasNewLlms = (params.additionalLlms?.length ?? 0) > 0;
  const hasNewContexts = (params.additionalContexts?.length ?? 0) > 0;
  const hasRemovedContexts = (params.removeContextIds?.length ?? 0) > 0;
  const hasSynthesisChange = params.synthesisLlm !== undefined;

  if (!hasNewLlms && !hasNewContexts && !hasRemovedContexts && !hasSynthesisChange) {
    return err({ type: 'NO_CHANGES' });
  }

  const enhanceParams: Parameters<typeof createEnhancedResearch>[0] = {
    id: deps.generateId(),
    userId: params.userId,
    sourceResearch: source,
  };
  if (params.additionalLlms !== undefined) {
    enhanceParams.additionalLlms = params.additionalLlms;
  }
  if (params.additionalContexts !== undefined) {
    enhanceParams.additionalContexts = params.additionalContexts;
  }
  if (params.synthesisLlm !== undefined) {
    enhanceParams.synthesisLlm = params.synthesisLlm;
  }
  if (params.removeContextIds !== undefined) {
    enhanceParams.removeContextIds = params.removeContextIds;
  }
  if (params.searchMode !== undefined) {
    enhanceParams.searchMode = params.searchMode;
  }
  const enhanced = createEnhancedResearch(enhanceParams);

  const saveResult = await deps.researchRepo.save(enhanced);
  if (!saveResult.ok) {
    return err({ type: 'REPO_ERROR', error: saveResult.error });
  }

  return ok(saveResult.value);
}
