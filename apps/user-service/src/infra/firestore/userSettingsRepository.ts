/**
 * Firestore implementation of UserSettingsRepository.
 * Stores per-user settings including LLM API keys and research settings.
 */

import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import {
  isIntexAgentModel,
  normalizeLlmModelPreferenceForRead,
  normalizeRetiredOpenRouterModel,
  type ExecutableLlmProvider,
  type IntexAgentModel,
} from '@intexuraos/llm-contract';
import type { EncryptedValue } from '../encryption.js';
import { FieldValue, getFirestore } from '@intexuraos/infra-firestore';
import {
  isValidTimezone,
  type IntexAgentModelReadResult,
  type IntexAgentModelUpdateResult,
  type LlmPreferences,
  type LlmProvider,
  type LlmTestResult,
  type SettingsError,
  type TranscriptionPreferences,
  type TranscriptionProvider,
  type UserSettings,
  type UserSettingsRepository,
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
  llmPreferences?: unknown;
  transcriptionPreferences?: TranscriptionPreferences;
  timezone?: string;
  createdAt: string;
  updatedAt: string;
}

function isFirestoreMap(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function readIntexAgentModelState(
  preferences: unknown
):
  | { ok: true; explicitModel: IntexAgentModel | null; revision: number }
  | { ok: false } {
  if (preferences === undefined) {
    return { ok: true, explicitModel: null, revision: 0 };
  }
  if (!isFirestoreMap(preferences)) {
    return { ok: false };
  }

  const hasModel = Object.hasOwn(preferences, 'intexAgentModel');
  let explicitModel: IntexAgentModel | null = null;
  if (hasModel) {
    const model = preferences['intexAgentModel'];
    if (typeof model !== 'string') {
      return { ok: false };
    }
    const normalizedModel = normalizeRetiredOpenRouterModel(model);
    if (!isIntexAgentModel(normalizedModel)) {
      return { ok: false };
    }
    explicitModel = normalizedModel;
  }

  const hasRevision = Object.hasOwn(preferences, 'intexAgentModelRevision');
  let revision = 0;
  if (hasRevision) {
    const storedRevision = preferences['intexAgentModelRevision'];
    if (
      typeof storedRevision !== 'number' ||
      !Number.isSafeInteger(storedRevision) ||
      storedRevision < 0
    ) {
      return { ok: false };
    }
    revision = storedRevision;
  }

  return { ok: true, explicitModel, revision };
}

function normalizeLlmPreferencesForRead(preferences: Record<string, unknown>): LlmPreferences {
  const normalized: Record<string, unknown> = { ...preferences };
  for (const field of ['defaultModel', 'fallbackModel'] as const) {
    const model = normalized[field];
    if (typeof model === 'string') {
      normalized[field] = normalizeLlmModelPreferenceForRead(model);
    }
  }
  const intexAgentModel = normalized['intexAgentModel'];
  if (typeof intexAgentModel === 'string') {
    normalized['intexAgentModel'] = normalizeRetiredOpenRouterModel(intexAgentModel);
  }
  return normalized as LlmPreferences;
}

/**
 * Firestore-backed User settings repository.
 */
export class FirestoreUserSettingsRepository implements UserSettingsRepository {
  async getIntexAgentModelState(
    userId: string
  ): Promise<Result<IntexAgentModelReadResult, SettingsError>> {
    try {
      const db = getFirestore();
      const doc = await db.collection(COLLECTION_NAME).doc(userId).get();
      const data = doc.exists ? (doc.data() as UserSettingsDoc) : undefined;
      const state = readIntexAgentModelState(data?.llmPreferences);
      if (!state.ok) {
        return ok({ status: 'invalid_stored_value' });
      }
      return ok({
        status: 'valid',
        explicitModel: state.explicitModel,
        revision: state.revision,
      });
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to get Intex Agent model state: ${getErrorMessage(error, 'Unknown Firestore error')}`,
      });
    }
  }

  async getTimezonePreference(userId: string): Promise<Result<string | undefined, SettingsError>> {
    try {
      const db = getFirestore();
      const doc = await db.collection(COLLECTION_NAME).doc(userId).get();
      if (!doc.exists) {
        return ok(undefined);
      }
      const data: unknown = doc.data();
      /* v8 ignore start -- upstream: an existing Firestore DocumentSnapshot cannot expose a non-map document payload @preserve */
      if (!isFirestoreMap(data)) {
        return err({ code: 'INTERNAL_ERROR', message: 'Stored timezone preference is invalid' });
      }
      /* v8 ignore stop @preserve */
      if (!Object.hasOwn(data, 'timezone')) {
        return ok(undefined);
      }
      const timezone = data['timezone'];
      if (typeof timezone !== 'string' || !isValidTimezone(timezone)) {
        return err({ code: 'INTERNAL_ERROR', message: 'Stored timezone preference is invalid' });
      }
      return ok(timezone);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to get timezone preference: ${getErrorMessage(error, 'Unknown Firestore error')}`,
      });
    }
  }

  async getSettings(userId: string): Promise<Result<UserSettings | null, SettingsError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(userId);
      const doc = await docRef.get();

      if (!doc.exists) {
        return ok(null);
      }

      const data = doc.data() as UserSettingsDoc;
      if (!readIntexAgentModelState(data.llmPreferences).ok) {
        return err({
          code: 'INTERNAL_ERROR',
          message: 'Invalid stored Intex Agent model state',
        });
      }
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
        settings.llmPreferences = normalizeLlmPreferencesForRead(
          data.llmPreferences as Record<string, unknown>
        );
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
    provider: ExecutableLlmProvider,
    encryptedKey: EncryptedValue
  ): Promise<Result<void, SettingsError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(userId);
      await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);
        const now = new Date().toISOString();
        if (!doc.exists) {
          transaction.set(docRef, {
            userId,
            llmApiKeys: { [provider]: encryptedKey },
            createdAt: now,
            updatedAt: now,
          });
        } else {
          transaction.update(docRef, {
            [`llmApiKeys.${provider}`]: encryptedKey,
            updatedAt: now,
          });
        }
      });

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
    provider: ExecutableLlmProvider,
    testResult: LlmTestResult
  ): Promise<Result<void, SettingsError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(userId);
      await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);
        const now = new Date().toISOString();
        if (!doc.exists) {
          transaction.set(docRef, {
            userId,
            llmTestResults: { [provider]: testResult },
            createdAt: now,
            updatedAt: now,
          });
        } else {
          transaction.update(docRef, {
            [`llmTestResults.${provider}`]: testResult,
            updatedAt: now,
          });
        }
      });

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
      await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);
        const now = new Date().toISOString();
        if (!doc.exists) {
          transaction.set(docRef, {
            userId,
            llmTestResults: { [provider]: { status: 'success', message: '', testedAt: now } },
            createdAt: now,
            updatedAt: now,
          });
          return;
        }

        const data = doc.data() as UserSettingsDoc;
        const existingTestResult = data.llmTestResults?.[provider];
        const completeTestResult: LlmTestResult = {
          status: existingTestResult?.status ?? 'success',
          message: existingTestResult?.message ?? '',
          testedAt: now,
        };
        transaction.update(docRef, {
          [`llmTestResults.${provider}`]: completeTestResult,
          updatedAt: now,
        });
      });

      return ok(undefined);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to update LLM last used: ${getErrorMessage(error, 'Unknown Firestore error')}`,
      });
    }
  }

  async clearLlmPreferences(userId: string): Promise<Result<void, SettingsError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(userId);
      await docRef.update({
        'llmPreferences.defaultModel': FieldValue.delete(),
        'llmPreferences.fallbackModel': FieldValue.delete(),
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
      await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);
        const now = new Date().toISOString();
        if (!doc.exists) {
          const preferences: Record<string, unknown> = { defaultModel };
          if (fallbackModel !== undefined && fallbackModel !== null) {
            preferences['fallbackModel'] = fallbackModel;
          }
          transaction.set(docRef, {
            userId,
            llmPreferences: preferences,
            createdAt: now,
            updatedAt: now,
          });
          return;
        }

        const updates: Record<string, unknown> = {
          'llmPreferences.defaultModel': defaultModel,
          updatedAt: now,
        };
        if (fallbackModel === null) {
          updates['llmPreferences.fallbackModel'] = FieldValue.delete();
        } else if (fallbackModel !== undefined) {
          updates['llmPreferences.fallbackModel'] = fallbackModel;
        }
        transaction.update(docRef, updates);
      });

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
      await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);
        const now = new Date().toISOString();
        if (!doc.exists) {
          transaction.set(docRef, {
            userId,
            transcriptionPreferences: { provider },
            createdAt: now,
            updatedAt: now,
          });
        } else {
          transaction.update(docRef, {
            'transcriptionPreferences.provider': provider,
            updatedAt: now,
          });
        }
      });

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
      await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);
        const now = new Date().toISOString();
        if (!doc.exists) {
          transaction.set(docRef, {
            userId,
            timezone,
            createdAt: now,
            updatedAt: now,
          });
        } else {
          transaction.update(docRef, {
            timezone,
            updatedAt: now,
          });
        }
      });

      return ok(undefined);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to update timezone: ${getErrorMessage(error, 'Unknown Firestore error')}`,
      });
    }
  }

  async updateIntexAgentModel(
    userId: string,
    intexAgentModel: IntexAgentModel | null,
    expectedRevision: number
  ): Promise<Result<IntexAgentModelUpdateResult, SettingsError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(userId);
      const result = await db.runTransaction<IntexAgentModelUpdateResult>(async (transaction) => {
        const doc = await transaction.get(docRef);
        const data = doc.exists ? (doc.data() as UserSettingsDoc) : undefined;
        const state = readIntexAgentModelState(data?.llmPreferences);
        if (!state.ok) {
          return { status: 'invalid_stored_value' };
        }
        if (state.revision !== expectedRevision) {
          return { status: 'conflict', explicitModel: state.explicitModel, revision: state.revision };
        }
        if (state.explicitModel === intexAgentModel) {
          return { status: 'unchanged', explicitModel: state.explicitModel, revision: state.revision };
        }
        if (state.revision === Number.MAX_SAFE_INTEGER) {
          return {
            status: 'revision_exhausted',
            explicitModel: state.explicitModel,
            revision: state.revision,
          };
        }

        const now = new Date().toISOString();
        const revision = state.revision + 1;
        if (!doc.exists) {
          transaction.set(docRef, {
            userId,
            llmPreferences: {
              intexAgentModel,
              intexAgentModelRevision: revision,
            },
            createdAt: now,
            updatedAt: now,
          });
        } else {
          transaction.update(docRef, {
            'llmPreferences.intexAgentModel': intexAgentModel ?? FieldValue.delete(),
            'llmPreferences.intexAgentModelRevision': revision,
            updatedAt: now,
          });
        }
        return { status: 'updated', explicitModel: intexAgentModel, revision };
      });
      return ok(result);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to update Intex Agent model: ${getErrorMessage(error, 'Unknown Firestore error')}`,
      });
    }
  }
}
