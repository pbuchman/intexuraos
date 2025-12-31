/**
 * Firestore implementation of UserSettingsRepository.
 * Stores per-user settings with notification filters.
 */

import {
  ok,
  err,
  type Result,
  type EncryptedValue,
  getErrorMessage,
} from '@intexuraos/common-core';
import { getFirestore, FieldValue } from '@intexuraos/infra-firestore';
import type {
  UserSettingsRepository,
  UserSettings,
  SettingsError,
  LlmProvider,
  LlmTestResult,
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
  llmApiKeys?: {
    google?: EncryptedValue;
    openai?: EncryptedValue;
    anthropic?: EncryptedValue;
  };
  llmTestResults?: {
    google?: LlmTestResult;
    openai?: LlmTestResult;
    anthropic?: LlmTestResult;
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
      const settings: UserSettings = {
        userId: data.userId,
        notifications: data.notifications,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      };
      if (data.llmApiKeys !== undefined) {
        settings.llmApiKeys = data.llmApiKeys;
      }
      if (data.llmTestResults !== undefined) {
        settings.llmTestResults = data.llmTestResults;
      }
      return ok(settings);
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
      if (settings.llmApiKeys !== undefined) {
        doc.llmApiKeys = settings.llmApiKeys;
      }

      await docRef.set(doc);

      return ok(settings);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to save settings: ${getErrorMessage(error, 'Unknown Firestore error')}`,
      });
    }
  }

  async updateLlmApiKey(
    userId: string,
    provider: LlmProvider,
    encryptedKey: EncryptedValue
  ): Promise<Result<void, SettingsError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(userId);
      const doc = await docRef.get();

      if (!doc.exists) {
        const now = new Date().toISOString();
        await docRef.set({
          userId,
          notifications: { filters: [] },
          llmApiKeys: { [provider]: encryptedKey },
          createdAt: now,
          updatedAt: now,
        });
      } else {
        await docRef.update({
          [`llmApiKeys.${provider}`]: encryptedKey,
          updatedAt: new Date().toISOString(),
        });
      }

      return ok(undefined);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to update LLM API key: ${getErrorMessage(error, 'Unknown Firestore error')}`,
      });
    }
  }

  async deleteLlmApiKey(
    userId: string,
    provider: LlmProvider
  ): Promise<Result<void, SettingsError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(userId);

      await docRef.update({
        [`llmApiKeys.${provider}`]: FieldValue.delete(),
        [`llmTestResults.${provider}`]: FieldValue.delete(),
        updatedAt: new Date().toISOString(),
      });

      return ok(undefined);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to delete LLM API key: ${getErrorMessage(error, 'Unknown Firestore error')}`,
      });
    }
  }

  async updateLlmTestResult(
    userId: string,
    provider: LlmProvider,
    testResult: LlmTestResult
  ): Promise<Result<void, SettingsError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(userId);
      const doc = await docRef.get();

      if (!doc.exists) {
        const now = new Date().toISOString();
        await docRef.set({
          userId,
          notifications: { filters: [] },
          llmTestResults: { [provider]: testResult },
          createdAt: now,
          updatedAt: now,
        });
      } else {
        await docRef.update({
          [`llmTestResults.${provider}`]: testResult,
          updatedAt: new Date().toISOString(),
        });
      }

      return ok(undefined);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to update LLM test result: ${getErrorMessage(error, 'Unknown Firestore error')}`,
      });
    }
  }
}
