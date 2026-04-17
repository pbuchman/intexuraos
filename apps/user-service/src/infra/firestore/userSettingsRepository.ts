/**
 * Firestore implementation of UserSettingsRepository.
 * Stores per-user settings including LLM API keys and research settings.
 */

import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type { EncryptedValue } from '../encryption.js';
import { FieldValue, getFirestore } from '@intexuraos/infra-firestore';
import type {
  LlmPreferences,
  LlmProvider,
  LlmTestResult,
  SettingsError,
  TranscriptionPreferences,
  TranscriptionProvider,
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
    perplexity?: EncryptedValue;
    openrouter?: EncryptedValue;
  };
  llmTestResults?: {
    google?: LlmTestResult;
    openai?: LlmTestResult;
    anthropic?: LlmTestResult;
    perplexity?: LlmTestResult;
    openrouter?: LlmTestResult;
  };
  llmPreferences?: LlmPreferences;
  transcriptionPreferences?: TranscriptionPreferences;
  timezone?: string;
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
      if (data.llmPreferences !== undefined) {
        settings.llmPreferences = data.llmPreferences;
      }
      if (data.transcriptionPreferences !== undefined) {
        settings.transcriptionPreferences = data.transcriptionPreferences;
      }
      if (data.timezone !== undefined) {
        settings.timezone = data.timezone;
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
      if (settings.llmPreferences !== undefined) {
        doc.llmPreferences = settings.llmPreferences;
      }
      if (settings.transcriptionPreferences !== undefined) {
        doc.transcriptionPreferences = settings.transcriptionPreferences;
      }
      if (settings.timezone !== undefined) {
        doc.timezone = settings.timezone;
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
          llmTestResults: { [provider]: { status: 'success', message: '', testedAt: now } },
          createdAt: now,
          updatedAt: now,
        });
      } else {
        const data = doc.data() as UserSettingsDoc;
        const existingTestResult = data.llmTestResults?.[provider];

        const completeTestResult: LlmTestResult = {
          status: existingTestResult?.status ?? 'success',
          message: existingTestResult?.message ?? '',
          testedAt: now,
        };

        await docRef.update({
          [`llmTestResults.${provider}`]: completeTestResult,
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

  // Note: Deletes the entire `llmPreferences` field, clearing both `defaultModel`
  // and `fallbackModel` (and any future preference fields). Used when a provider's
  // API key is deleted and the default model belongs to that provider.
  async clearLlmPreferences(userId: string): Promise<Result<void, SettingsError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(userId);
      await docRef.update({
        llmPreferences: FieldValue.delete(),
        updatedAt: new Date().toISOString(),
      });
      return ok(undefined);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to clear LLM preferences: ${getErrorMessage(error, 'Unknown Firestore error')}`,
      });
    }
  }

  async updateLlmPreferences(
    userId: string,
    defaultModel: string,
    fallbackModel?: string | null
  ): Promise<Result<void, SettingsError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(userId);
      const doc = await docRef.get();

      if (!doc.exists) {
        const now = new Date().toISOString();
        const preferences: Record<string, unknown> = { defaultModel };
        if (fallbackModel !== undefined && fallbackModel !== null) {
          preferences['fallbackModel'] = fallbackModel;
        }
        await docRef.set({
          userId,
          llmPreferences: preferences,
          createdAt: now,
          updatedAt: now,
        });
      } else {
        const updates: Record<string, unknown> = {
          'llmPreferences.defaultModel': defaultModel,
          updatedAt: new Date().toISOString(),
        };
        if (fallbackModel === null) {
          updates['llmPreferences.fallbackModel'] = FieldValue.delete();
        } else if (fallbackModel !== undefined) {
          updates['llmPreferences.fallbackModel'] = fallbackModel;
        }
        await docRef.update(updates);
      }

      return ok(undefined);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to update LLM preferences: ${getErrorMessage(error, 'Unknown Firestore error')}`,
      });
    }
  }

  async updateTranscriptionPreferences(
    userId: string,
    provider: TranscriptionProvider
  ): Promise<Result<void, SettingsError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(userId);
      const doc = await docRef.get();

      if (!doc.exists) {
        const now = new Date().toISOString();
        await docRef.set({
          userId,
          transcriptionPreferences: { provider },
          createdAt: now,
          updatedAt: now,
        });
      } else {
        await docRef.update({
          'transcriptionPreferences.provider': provider,
          updatedAt: new Date().toISOString(),
        });
      }

      return ok(undefined);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to update transcription preferences: ${getErrorMessage(error, 'Unknown Firestore error')}`,
      });
    }
  }

  async updateTimezone(userId: string, timezone: string): Promise<Result<void, SettingsError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(userId);
      const doc = await docRef.get();

      if (!doc.exists) {
        const now = new Date().toISOString();
        await docRef.set({
          userId,
          timezone,
          createdAt: now,
          updatedAt: now,
        });
      } else {
        await docRef.update({
          timezone,
          updatedAt: new Date().toISOString(),
        });
      }

      return ok(undefined);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to update timezone: ${getErrorMessage(error, 'Unknown Firestore error')}`,
      });
    }
  }
}
