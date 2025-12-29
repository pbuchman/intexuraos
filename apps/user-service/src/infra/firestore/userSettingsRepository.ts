/**
 * Firestore implementation of UserSettingsRepository.
 * Stores per-user settings with notification filters.
 */

import { ok, err, type Result, getErrorMessage } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type {
  UserSettingsRepository,
  UserSettings,
  SettingsError,
} from '../../domain/settings/index.js';

const COLLECTION_NAME = 'user_settings';

/**
 * Document structure in Firestore.
 */
interface UserSettingsDoc {
  userId: string;
  notifications: {
    filters: { name: string; app?: string; source?: string; title?: string }[];
  };
  createdAt: string;
  updatedAt: string;
}

/**
 * Firestore-backed User settings repository.
 */
export class FirestoreUserSettingsRepository implements UserSettingsRepository {
  async getSettings(userId: string): Promise<Result<UserSettings | null, SettingsError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(userId);
      const doc = await docRef.get();

      if (!doc.exists) {
        return ok(null);
      }

      const data = doc.data() as UserSettingsDoc;
      return ok({
        userId: data.userId,
        notifications: data.notifications,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      });
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to get settings: ${getErrorMessage(error, 'Unknown Firestore error')}`,
      });
    }
  }

  async saveSettings(settings: UserSettings): Promise<Result<UserSettings, SettingsError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(settings.userId);

      const doc: UserSettingsDoc = {
        userId: settings.userId,
        notifications: settings.notifications,
        createdAt: settings.createdAt,
        updatedAt: settings.updatedAt,
      };

      await docRef.set(doc);

      return ok(settings);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to save settings: ${getErrorMessage(error, 'Unknown Firestore error')}`,
      });
    }
  }
}
