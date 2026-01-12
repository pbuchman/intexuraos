/**
 * Toggle research favourite usecase.
 * Marks or unmarks a research as a favourite for the user.
 */

import type { Result } from '@intexuraos/common-core';
import type { Research } from '../models/index.js';
import type { RepositoryError, ResearchRepository } from '../ports/index.js';

interface ToggleResearchFavouriteParams {
  researchId: string;
  userId: string;
  favourite: boolean;
}

interface ToggleResearchFavouriteDeps {
  researchRepo: ResearchRepository;
}

type ToggleResearchFavouriteError =
  | { type: 'NOT_FOUND' }
  | { type: 'FORBIDDEN' }
  | { type: 'REPO_ERROR'; error: RepositoryError };

export async function toggleResearchFavourite(
  params: ToggleResearchFavouriteParams,
  deps: ToggleResearchFavouriteDeps
): Promise<Result<Research, ToggleResearchFavouriteError>> {
  const getResult = await deps.researchRepo.findById(params.researchId);
  if (!getResult.ok) {
    return { ok: false, error: { type: 'REPO_ERROR', error: getResult.error } };
  }
  if (getResult.value === null) {
    return { ok: false, error: { type: 'NOT_FOUND' } };
  }

  const research = getResult.value;

  if (research.userId !== params.userId) {
    return { ok: false, error: { type: 'FORBIDDEN' } };
  }

  const updateResult = await deps.researchRepo.update(params.researchId, {
    favourite: params.favourite,
  });
  if (!updateResult.ok) {
    return { ok: false, error: { type: 'REPO_ERROR', error: updateResult.error } };
  }

  return { ok: true, value: updateResult.value };
}

export type { ToggleResearchFavouriteParams, ToggleResearchFavouriteDeps, ToggleResearchFavouriteError };
