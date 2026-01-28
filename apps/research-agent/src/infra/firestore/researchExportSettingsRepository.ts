/**
 * Firestore repository for Research Export settings.
 * Owned by research-agent - manages researchPageId, pageTitle, and pageUrl for Notion export.
 */
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';

export interface ResearchExportSettingsError {
  code: 'INTERNAL_ERROR';
  message: string;
}

export interface ResearchExportSettings {
  researchPageId: string;
  researchPageTitle: string;
  researchPageUrl: string;
  createdAt: string;
  updatedAt: string;
}

interface ResearchExportSettingsDoc {
  userId: string;
  researchPageId: string;
  researchPageTitle: string;
  researchPageUrl: string;
  createdAt: string;
  updatedAt: string;
}

const COLLECTION_NAME = 'research_export_settings';

/**
 * Get research export settings for a user.
 * Returns null if not configured.
 */
export async function getResearchSettings(
  userId: string
): Promise<Result<ResearchExportSettings | null, ResearchExportSettingsError>> {
  try {
    const db = getFirestore();
    const doc = await db.collection(COLLECTION_NAME).doc(userId).get();

    if (!doc.exists) {
      return ok(null);
    }

    const data = doc.data() as ResearchExportSettingsDoc | undefined;
    const pageId = data?.researchPageId ?? '';
    if (pageId === '' || data === undefined) {
      return ok(null);
    }

    return ok({
      researchPageId: data.researchPageId,
      researchPageTitle: data.researchPageTitle,
      researchPageUrl: data.researchPageUrl,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    });
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to get research settings: ${getErrorMessage(error)}`,
    });
  }
}

/**
 * Get researchPageId for a user.
 * Returns null if not configured.
 * @deprecated Use getResearchSettings instead.
 */
export async function getResearchPageId(
  userId: string
): Promise<Result<string | null, ResearchExportSettingsError>> {
  const result = await getResearchSettings(userId);
  if (!result.ok) {
    return result;
  }
  if (result.value === null) {
    return ok(null);
  }
  return ok(result.value.researchPageId);
}

/**
 * Save research export settings for a user.
 */
export async function saveResearchSettings(
  userId: string,
  researchPageId: string,
  researchPageTitle: string,
  researchPageUrl: string
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
      researchPageTitle,
      researchPageUrl,
      createdAt,
      updatedAt: now,
    };

    await docRef.set(settingsDoc);

    return ok({
      researchPageId,
      researchPageTitle,
      researchPageUrl,
      createdAt,
      updatedAt: now,
    });
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to save research settings: ${getErrorMessage(error)}`,
    });
  }
}

/**
 * Save researchPageId for a user.
 * @deprecated Use saveResearchSettings instead.
 */
export async function saveResearchPageId(
  userId: string,
  researchPageId: string
): Promise<Result<ResearchExportSettings, ResearchExportSettingsError>> {
  // For backwards compatibility, provide default values for title and url
  return await saveResearchSettings(userId, researchPageId, '', '');
}
