/**
 * Firestore repository for Research Export settings.
 * Owned by research-agent - manages researchPageId for Notion export.
 */
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';

export interface ResearchExportSettingsError {
  code: 'INTERNAL_ERROR';
  message: string;
}

export interface ResearchExportSettings {
  researchPageId: string;
  createdAt: string;
  updatedAt: string;
}

interface ResearchExportSettingsDoc {
  userId: string;
  researchPageId: string;
  createdAt: string;
  updatedAt: string;
}

const COLLECTION_NAME = 'research_export_settings';

/**
 * Get researchPageId for a user.
 * Returns null if not configured.
 */
export async function getResearchPageId(
  userId: string
): Promise<Result<string | null, ResearchExportSettingsError>> {
  try {
    const db = getFirestore();
    const doc = await db.collection(COLLECTION_NAME).doc(userId).get();

    if (!doc.exists) {
      return ok(null);
    }

    const data = doc.data() as ResearchExportSettingsDoc | undefined;
    return ok(data?.researchPageId ?? null);
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to get research page ID: ${getErrorMessage(error)}`,
    });
  }
}

/**
 * Save researchPageId for a user.
 */
export async function saveResearchPageId(
  userId: string,
  researchPageId: string
): Promise<Result<ResearchExportSettings, ResearchExportSettingsError>> {
  try {
    const db = getFirestore();
    const docRef = db.collection(COLLECTION_NAME).doc(userId);
    const now = new Date().toISOString();

    const existing = await docRef.get();
    const createdAt = existing.exists
      ? ((existing.data() as ResearchExportSettingsDoc | undefined)?.createdAt ?? now)
      : now;

    const settingsDoc: ResearchExportSettingsDoc = {
      userId,
      researchPageId,
      createdAt,
      updatedAt: now,
    };

    await docRef.set(settingsDoc);

    return ok({
      researchPageId,
      createdAt,
      updatedAt: now,
    });
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to save research page ID: ${getErrorMessage(error)}`,
    });
  }
}
