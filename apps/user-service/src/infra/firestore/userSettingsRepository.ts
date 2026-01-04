/**
 * Firestore implementation of UserSettingsRepository.
 * Stores per-user settings including LLM API keys and research settings.
 */

import {
  type EncryptedValue,
  err,
  getErrorMessage,
  ok,
  type Result,
} from '@intexuraos/common-core';
import { FieldValue, getFirestore } from '@intexuraos/infra-firestore';
import type {
  LlmProvider,
  LlmTestResult,
  SettingsError,
  UserSettings,
  UserSettingsRepository,
} from '../../domain/settings/index.js';

const COLLECTION_NAME = 'user_settings';

/**
 * Document structure in Firestore.
 */
interface UserSettingsDoc {
  userId: string;
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
        createdAt: settings.createdAt,
        updatedAt: settings.updatedAt,
      };
      if (settings.llmApiKeys !== undefined) {
        doc.llmApiKeys = settings.llmApiKeys;
      }
      if (settings.llmTestResults !== undefined) {
        doc.llmTestResults = settings.llmTestResults;
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

  async updateLlmLastUsed(
    userId: string,
    provider: LlmProvider
  ): Promise<Result<void, SettingsError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(userId);
      const doc = await docRef.get();
      const now = new Date().toISOString();

      if (!doc.exists) {
        await docRef.set({
          userId,
          llmTestResults: { [provider]: { response: '', testedAt: now } },
          createdAt: now,
          updatedAt: now,
        });
      } else {
        await docRef.update({
          [`llmTestResults.${provider}.testedAt`]: now,
          updatedAt: now,
        });
      }

      return ok(undefined);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to update LLM last used: ${getErrorMessage(error, 'Unknown Firestore error')}`,
      });
    }
  }
}
