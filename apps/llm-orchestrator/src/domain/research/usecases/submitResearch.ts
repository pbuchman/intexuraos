/**
 * Submit research usecase.
 * Creates a new research record for async processing.
 */

import type { Result } from '@intexuraos/common-core';
import {
  createResearch,
  type LlmProvider,
  type Research,
  type SearchMode,
} from '../models/index.js';
import type { RepositoryError, ResearchRepository } from '../ports/index.js';

export interface SubmitResearchParams {
  userId: string;
  prompt: string;
  selectedLlms: LlmProvider[];
  synthesisLlm: LlmProvider;
  externalReports?: { content: string; model?: string }[];
  skipSynthesis?: boolean;
  searchMode?: SearchMode;
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
    selectedLlms: params.selectedLlms,
    synthesisLlm: params.synthesisLlm,
  };
  if (params.searchMode !== undefined) {
    createParams.searchMode = params.searchMode;
  }
  if (params.externalReports !== undefined) {
    createParams.externalReports = params.externalReports;
  }
  if (params.skipSynthesis === true) {
    createParams.skipSynthesis = true;
  }
  const research = createResearch(createParams);

  return await deps.researchRepo.save(research);
}
