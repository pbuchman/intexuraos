/**
 * Firestore repository for Prompt Vault settings.
 * Owned by promptvault-service - manages promptVaultPageId.
 */
import { ok, err, type Result, getErrorMessage } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';

export interface PromptVaultError {
  code: 'INTERNAL_ERROR';
  message: string;
}

export interface PromptVaultSettings {
  promptVaultPageId: string;
  createdAt: string;
  updatedAt: string;
}

interface PromptVaultSettingsDoc {
  userId: string;
  promptVaultPageId: string;
  createdAt: string;
  updatedAt: string;
}

const COLLECTION_NAME = 'promptvault_settings';

/**
 * Get promptVaultPageId for a user.
 * Returns null if not configured.
 */
export async function getPromptVaultPageId(
  userId: string
): Promise<Result<string | null, PromptVaultError>> {
  try {
    const db = getFirestore();
    const doc = await db.collection(COLLECTION_NAME).doc(userId).get();

    if (!doc.exists) {
      return ok(null);
    }

    const data = doc.data() as PromptVaultSettingsDoc | undefined;
    return ok(data?.promptVaultPageId ?? null);
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to get prompt vault page ID: ${getErrorMessage(error)}`,
    });
  }
}

/**
 * Save promptVaultPageId for a user.
 */
export async function savePromptVaultPageId(
  userId: string,
  promptVaultPageId: string
): Promise<Result<PromptVaultSettings, PromptVaultError>> {
  try {
    const db = getFirestore();
    const docRef = db.collection(COLLECTION_NAME).doc(userId);
    const now = new Date().toISOString();

    const existing = await docRef.get();
    const createdAt = existing.exists
      ? ((existing.data() as PromptVaultSettingsDoc | undefined)?.createdAt ?? now)
      : now;

    const settingsDoc: PromptVaultSettingsDoc = {
      userId,
      promptVaultPageId,
      createdAt,
      updatedAt: now,
    };

    await docRef.set(settingsDoc);

    return ok({
      promptVaultPageId,
      createdAt,
      updatedAt: now,
    });
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to save prompt vault page ID: ${getErrorMessage(error)}`,
    });
  }
}
