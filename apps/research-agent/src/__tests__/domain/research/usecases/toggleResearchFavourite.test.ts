/**
 * Tests for toggleResearchFavourite use case.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { err } from '@intexuraos/common-core';
import {
  toggleResearchFavourite,
  type ToggleResearchFavouriteDeps,
} from '../../../../domain/research/usecases/toggleResearchFavourite.js';

function createMockDeps(): ToggleResearchFavouriteDeps & {
  mockRepo: { findById: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
} {
  const mockRepo = {
    findById: vi.fn(),
    save: vi.fn(),
    update: vi.fn(),
    updateLlmResult: vi.fn(),
    findByUserId: vi.fn(),
    findSummariesByUserId: vi.fn(),
    clearShareInfo: vi.fn(),
    delete: vi.fn(),
  };

  return {
    researchRepo: mockRepo,
    mockRepo,
  };
}

describe('toggleResearchFavourite', () => {
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    deps = createMockDeps();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns REPO_ERROR when findById fails', async () => {
    const repoError = { code: 'FIRESTORE_ERROR' as const, message: 'DB connection failed' };
    deps.mockRepo.findById.mockResolvedValue(err(repoError));

    const result = await toggleResearchFavourite(
      { researchId: 'research-1', userId: 'user-1', favourite: true },
      deps
    );

    expect(result).toEqual({
      ok: false,
      error: { type: 'REPO_ERROR', error: repoError },
    });
  });
});
