/**
 * Unshare research use case.
 * Removes public access by deleting the shared HTML from GCS,
 * deleting the cover image (if any), and clearing shareInfo from the research document.
 */

import type { ResearchRepository, ShareStoragePort } from '../ports/index.js';
import type { ImageServiceClient } from '../../../services.js';

export interface UnshareResearchDeps {
  researchRepo: ResearchRepository;
  shareStorage: ShareStoragePort | null;
  imageServiceClient: ImageServiceClient | null;
  logger?: { info: (msg: string) => void; error: (obj: object, msg: string) => void };
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
  const { researchRepo, shareStorage, imageServiceClient, logger } = deps;

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

  if (imageServiceClient !== null && research.shareInfo.coverImageId !== undefined) {
    logger?.info(`Deleting cover image: ${research.shareInfo.coverImageId}`);
    const imageDeleteResult = await imageServiceClient.deleteImage(research.shareInfo.coverImageId);
    if (!imageDeleteResult.ok) {
      logger?.error({ error: imageDeleteResult.error }, 'Failed to delete cover image');
    }
  }

  const updateResult = await researchRepo.clearShareInfo(researchId);
  if (!updateResult.ok) {
    return { ok: false, error: 'Failed to update research' };
  }

  return { ok: true };
}
