/**
 * Submit research usecase.
 * Creates a new research record for async processing.
 */

import type { Result } from '@intexuraos/common-core';
import { createResearch, type Research, type LlmProvider } from '../models/index.js';
import type { ResearchRepository, RepositoryError } from '../ports/index.js';

export interface SubmitResearchParams {
  userId: string;
  prompt: string;
  selectedLlms: LlmProvider[];
}

export interface SubmitResearchDeps {
  researchRepo: ResearchRepository;
  generateId: () => string;
}

export async function submitResearch(
  params: SubmitResearchParams,
  deps: SubmitResearchDeps
): Promise<Result<Research, RepositoryError>> {
  const research = createResearch({
    id: deps.generateId(),
    userId: params.userId,
    prompt: params.prompt,
    selectedLlms: params.selectedLlms,
  });

  return await deps.researchRepo.save(research);
}
