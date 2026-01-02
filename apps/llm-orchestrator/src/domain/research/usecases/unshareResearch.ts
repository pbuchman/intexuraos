/**
 * Unshare research use case.
 * Removes public access by deleting the shared HTML from GCS
 * and clearing shareInfo from the research document.
 */

import type { ResearchRepository, ShareStoragePort } from '../ports/index.js';

export interface UnshareResearchDeps {
  researchRepo: ResearchRepository;
  shareStorage: ShareStoragePort | null;
}

export interface UnshareResearchResult {
  ok: boolean;
  error?: string;
}

export async function unshareResearch(
  researchId: string,
  userId: string,
  deps: UnshareResearchDeps
): Promise<UnshareResearchResult> {
  const { researchRepo, shareStorage } = deps;

  const researchResult = await researchRepo.findById(researchId);
  if (!researchResult.ok || researchResult.value === null) {
    return { ok: false, error: 'Research not found' };
  }

  const research = researchResult.value;

  if (research.userId !== userId) {
    return { ok: false, error: 'Access denied' };
  }

  if (research.shareInfo === undefined) {
    return { ok: false, error: 'Research is not shared' };
  }

  if (shareStorage !== null) {
    const deleteResult = await shareStorage.delete(research.shareInfo.gcsPath);
    if (!deleteResult.ok) {
      return { ok: false, error: deleteResult.error.message };
    }
  }

  const updateResult = await researchRepo.clearShareInfo(researchId);
  if (!updateResult.ok) {
    return { ok: false, error: 'Failed to update research' };
  }

  return { ok: true };
}
