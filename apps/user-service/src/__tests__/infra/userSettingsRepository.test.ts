/**
 * Tests for Firestore UserSettings repository.
 * Uses FakeFirestore for in-memory testing.
 */
import { IntexAgentModels, LlmModels, LlmProviders } from '@intexuraos/llm-contract';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import type { EncryptedValue } from '../../infra/encryption.js';
import { FirestoreUserSettingsRepository } from '../../infra/firestore/index.js';
import type { LlmTestResult, UserSettings } from '../../domain/settings/index.js';
import { FakeUserSettingsRepository } from '../fakes.js';

/**
 * Helper to create encrypted value fixture.
 */
function createEncryptedValue(key: string): EncryptedValue {
  return {
    ciphertext: `encrypted-${key}`,
    iv: 'test-iv',
    tag: 'test-tag',
  };
}

/**
 * Helper to create test settings with required fields.
 */
function createTestSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  const now = new Date().toISOString();
  return {
    userId: 'user-123',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('FirestoreUserSettingsRepository', () => {
  let repo: FirestoreUserSettingsRepository;
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    repo = new FirestoreUserSettingsRepository();
  });

  afterEach(() => {
    resetFirestore();
  });

  describe('getSettings', () => {
    it('returns null for non-existent user', async () => {
      const result = await repo.getSettings('unknown-user');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns settings for existing user', async () => {
      const settings = createTestSettings();
      await repo.saveSettings(settings);

      const result = await repo.getSettings('user-123');

      expect(result.ok).toBe(true);
      if (result.ok && result.value !== null) {
        expect(result.value.userId).toBe('user-123');
      }
    });

    it('returns settings with llmApiKeys when present', async () => {
      const settings = createTestSettings({
        llmApiKeys: {
          google: createEncryptedValue('google-key'),
        },
      });
      await repo.saveSettings(settings);

      const result = await repo.getSettings('user-123');

      expect(result.ok).toBe(true);
      if (result.ok && result.value !== null) {
        expect(result.value.llmApiKeys).toBeDefined();
        expect(result.value.llmApiKeys?.google).toBeDefined();
      }
    });

    it('returns settings with llmTestResults when present', async () => {
      const testResult: LlmTestResult = {
        status: 'success',
        message: 'Hello!',
        testedAt: new Date().toISOString(),
      };
      const settings = createTestSettings({
        llmTestResults: { google: testResult },
      });

      const saveResult = await repo.saveSettings(settings);
      expect(saveResult.ok).toBe(true);

      const result = await repo.getSettings('user-123');

      expect(result.ok).toBe(true);
      if (result.ok && result.value !== null) {
        expect(result.value.llmTestResults).toBeDefined();
        expect(result.value.llmTestResults?.google?.message).toBe('Hello!');
      }
    });

    it('returns error when Firestore fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Connection failed') });

      const result = await repo.getSettings('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Connection failed');
      }
    });

    it('fails closed for corrupt persisted Intex Agent selector state without rejecting general-only or unknown preference siblings', async () => {
      fakeFirestore.seedCollection('user_settings', [
        {
          id: 'bad-map',
          data: { userId: 'bad-map', llmPreferences: 'not-a-map', createdAt: 'created', updatedAt: 'updated' },
        },
        {
          id: 'bad-map-object',
          data: {
            userId: 'bad-map-object',
            llmPreferences: new Date('2026-07-19T00:00:00.000Z'),
            createdAt: 'created',
            updatedAt: 'updated',
          },
        },
        {
          id: 'bad-model',
          data: {
            userId: 'bad-model',
            llmPreferences: { intexAgentModel: 'not-a-model' },
            createdAt: 'created',
            updatedAt: 'updated',
          },
        },
        {
          id: 'bad-revision',
          data: {
            userId: 'bad-revision',
            llmPreferences: { intexAgentModelRevision: Number.MAX_SAFE_INTEGER + 1 },
            createdAt: 'created',
            updatedAt: 'updated',
          },
        },
        {
          id: 'general-only',
          data: {
            userId: 'general-only',
            llmPreferences: { defaultModel: LlmModels.GPT4oMini, futurePreference: { keep: true } },
            createdAt: 'created',
            updatedAt: 'updated',
          },
        },
      ]);

      for (const userId of ['bad-map', 'bad-map-object', 'bad-model', 'bad-revision']) {
        const result = await repo.getSettings(userId);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('INTERNAL_ERROR');
          expect(result.error.message).toContain('Invalid stored Intex Agent model state');
        }
      }

      expect(await repo.getSettings('general-only')).toEqual({
        ok: true,
        value: expect.objectContaining({
          llmPreferences: expect.objectContaining({
            defaultModel: LlmModels.GPT4oMini,
            futurePreference: { keep: true },
          }),
        }),
      });
    });
  });

  describe('saveSettings', () => {
    it('saves new settings', async () => {
      const settings = createTestSettings();

      const result = await repo.saveSettings(settings);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.userId).toBe('user-123');
      }

      // Verify in storage
      const stored = await repo.getSettings('user-123');
      expect(stored.ok).toBe(true);
      if (stored.ok && stored.value !== null) {
        expect(stored.value.userId).toBe('user-123');
      }
    });

    it('saves settings with llmApiKeys', async () => {
      const settings = createTestSettings({
        llmApiKeys: {
          google: createEncryptedValue('google-key'),
          openai: createEncryptedValue('openai-key'),
        },
      });

      const result = await repo.saveSettings(settings);

      expect(result.ok).toBe(true);

      const stored = await repo.getSettings('user-123');
      expect(stored.ok).toBe(true);
      if (stored.ok && stored.value !== null) {
        expect(stored.value.llmApiKeys?.google).toBeDefined();
        expect(stored.value.llmApiKeys?.openai).toBeDefined();
      }
    });

    it('returns error when Firestore fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Write failed') });

      const result = await repo.saveSettings(createTestSettings());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Write failed');
      }
    });

    it('preserves llmTestResults when updating other fields', async () => {
      const testResult: LlmTestResult = {
        testedAt: new Date().toISOString(),
        status: 'success',
        message:'Hello from GPT!',
      };
      const initialSettings = createTestSettings({
        llmTestResults: { openai: testResult },
      });
      await repo.saveSettings(initialSettings);

      const getResult = await repo.getSettings('user-123');
      expect(getResult.ok).toBe(true);
      const existingSettings = (getResult as { ok: true; value: typeof initialSettings }).value;

      const updatedSettings: UserSettings = {
        ...existingSettings,
        updatedAt: new Date().toISOString(),
      };
      await repo.saveSettings(updatedSettings);

      const result = await repo.getSettings('user-123');
      expect(result.ok).toBe(true);
      if (result.ok && result.value !== null) {
        expect(result.value.llmTestResults?.openai?.message).toBe('Hello from GPT!');
      }
    });
  });

  describe('updateLlmApiKey', () => {
    it('creates new settings document if user does not exist', async () => {
      const encryptedKey = createEncryptedValue('google-key');

      const result = await repo.updateLlmApiKey('new-user', LlmProviders.Google, encryptedKey);

      expect(result.ok).toBe(true);

      const stored = await repo.getSettings('new-user');
      expect(stored.ok).toBe(true);
      if (stored.ok && stored.value !== null) {
        expect(stored.value.userId).toBe('new-user');
        expect(stored.value.llmApiKeys?.google).toBeDefined();
      }
    });

    it('updates existing settings document', async () => {
      await repo.saveSettings(createTestSettings());

      const encryptedKey = createEncryptedValue('anthropic-key');
      const result = await repo.updateLlmApiKey('user-123', LlmProviders.Anthropic, encryptedKey);

      expect(result.ok).toBe(true);

      const stored = await repo.getSettings('user-123');
      expect(stored.ok).toBe(true);
      if (stored.ok && stored.value !== null) {
        expect(stored.value.llmApiKeys?.anthropic).toBeDefined();
      }
    });

    it('returns error when Firestore fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Update failed') });

      const result = await repo.updateLlmApiKey(
        'user-123',
        LlmProviders.Google,
        createEncryptedValue('key')
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Update failed');
      }
    });
  });

  describe('deleteLlmApiKey', () => {
    it('deletes existing API key', async () => {
      await repo.updateLlmApiKey(
        'user-123',
        LlmProviders.Google,
        createEncryptedValue('google-key')
      );
      await repo.updateLlmApiKey(
        'user-123',
        LlmProviders.OpenAI,
        createEncryptedValue('openai-key')
      );

      const result = await repo.deleteLlmApiKey('user-123', LlmProviders.Google);

      expect(result.ok).toBe(true);

      const stored = await repo.getSettings('user-123');
      expect(stored.ok).toBe(true);
      if (stored.ok && stored.value !== null) {
        expect(stored.value.llmApiKeys?.google).toBeUndefined();
        expect(stored.value.llmApiKeys?.openai).toBeDefined();
      }
    });

    it('deletes associated test result when deleting key', async () => {
      await repo.updateLlmApiKey('user-123', LlmProviders.Google, createEncryptedValue('key'));
      await repo.updateLlmTestResult('user-123', LlmProviders.Google, {
        status: 'success',
        message:'Test passed',
        testedAt: new Date().toISOString(),
      });

      const result = await repo.deleteLlmApiKey('user-123', LlmProviders.Google);

      expect(result.ok).toBe(true);

      const stored = await repo.getSettings('user-123');
      expect(stored.ok).toBe(true);
      if (stored.ok && stored.value !== null) {
        expect(stored.value.llmApiKeys?.google).toBeUndefined();
        expect(stored.value.llmTestResults?.google).toBeUndefined();
      }
    });

    it('returns error when Firestore fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Delete failed') });

      const result = await repo.deleteLlmApiKey('user-123', LlmProviders.Google);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Delete failed');
      }
    });
  });

  describe('updateLlmTestResult', () => {
    it('creates new settings document if user does not exist', async () => {
      const testResult: LlmTestResult = {
        testedAt: new Date().toISOString(),
        status: 'success',
        message:'Test response',
      };

      const result = await repo.updateLlmTestResult('new-user', LlmProviders.Google, testResult);

      expect(result.ok).toBe(true);

      const stored = await repo.getSettings('new-user');
      expect(stored.ok).toBe(true);
      if (stored.ok && stored.value !== null) {
        expect(stored.value.userId).toBe('new-user');
        expect(stored.value.llmTestResults?.google?.message).toBe('Test response');
      }
    });

    it('updates existing settings document', async () => {
      await repo.saveSettings(createTestSettings());

      const testResult: LlmTestResult = {
        testedAt: new Date().toISOString(),
        status: 'success',
        message:'OpenAI response',
      };

      const result = await repo.updateLlmTestResult('user-123', LlmProviders.OpenAI, testResult);

      expect(result.ok).toBe(true);

      const stored = await repo.getSettings('user-123');
      expect(stored.ok).toBe(true);
      if (stored.ok && stored.value !== null) {
        expect(stored.value.llmTestResults?.openai?.message).toBe('OpenAI response');
      }
    });

    it('returns error when Firestore fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Update failed') });

      const result = await repo.updateLlmTestResult('user-123', LlmProviders.Google, {
        status: 'success',
        message:'Test response',
        testedAt: new Date().toISOString(),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Update failed');
      }
    });
  });

  describe('updateLlmLastUsed', () => {
    it('creates new settings document if user does not exist', async () => {
      const result = await repo.updateLlmLastUsed('new-user', LlmProviders.Google);

      expect(result.ok).toBe(true);

      const stored = await repo.getSettings('new-user');
      expect(stored.ok).toBe(true);
      if (stored.ok && stored.value !== null) {
        expect(stored.value.userId).toBe('new-user');
        expect(stored.value.llmTestResults?.google?.testedAt).toBeDefined();
        expect(stored.value.llmTestResults?.google?.status).toBe('success');
        expect(stored.value.llmTestResults?.google?.message).toBe('');
      }
    });

    it('updates testedAt for existing settings document', async () => {
      await repo.saveSettings(createTestSettings());

      const result = await repo.updateLlmLastUsed('user-123', LlmProviders.OpenAI);

      expect(result.ok).toBe(true);

      const stored = await repo.getSettings('user-123');
      expect(stored.ok).toBe(true);
      if (stored.ok && stored.value !== null) {
        expect(stored.value.llmTestResults?.openai?.testedAt).toBeDefined();
        expect(stored.value.llmTestResults?.openai?.status).toBe('success');
        expect(stored.value.llmTestResults?.openai?.message).toBe('');
      }
    });

    it('heals partial test result data (missing status or message)', async () => {
      // Create settings with partial test result data (simulates legacy/bad data)
      const partialSettings = createTestSettings({
        llmTestResults: {
          openai: {
            testedAt: new Date().toISOString(),
            // Missing status and message - simulating bad data
          } as Partial<LlmTestResult> as LlmTestResult,
        },
      });
      await repo.saveSettings(partialSettings);

      // Call updateLlmLastUsed - should heal the partial data
      const result = await repo.updateLlmLastUsed('user-123', LlmProviders.OpenAI);
      expect(result.ok).toBe(true);

      const stored = await repo.getSettings('user-123');
      expect(stored.ok).toBe(true);
      if (stored.ok && stored.value !== null) {
        // Verify all required fields are now present
        expect(stored.value.llmTestResults?.openai?.status).toBe('success');
        expect(stored.value.llmTestResults?.openai?.message).toBe('');
        expect(stored.value.llmTestResults?.openai?.testedAt).toBeDefined();
      }
    });

    it('returns error when Firestore fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Update failed') });

      const result = await repo.updateLlmLastUsed('user-123', LlmProviders.Google);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Update failed');
      }
    });
  });

  describe('updateLlmPreferences', () => {
    it('creates new settings document if user does not exist', async () => {
      const result = await repo.updateLlmPreferences('new-user', LlmModels.Gemini25Flash);

      expect(result.ok).toBe(true);

      const stored = await repo.getSettings('new-user');
      expect(stored.ok).toBe(true);
      if (stored.ok && stored.value !== null) {
        expect(stored.value.userId).toBe('new-user');
        expect(stored.value.llmPreferences?.defaultModel).toBe(LlmModels.Gemini25Flash);
      }
    });

    it('updates existing settings document', async () => {
      await repo.saveSettings(createTestSettings());

      const result = await repo.updateLlmPreferences('user-123', LlmModels.ClaudeHaiku35);

      expect(result.ok).toBe(true);

      const stored = await repo.getSettings('user-123');
      expect(stored.ok).toBe(true);
      if (stored.ok && stored.value !== null) {
        expect(stored.value.llmPreferences?.defaultModel).toBe(LlmModels.ClaudeHaiku35);
      }
    });

    it('returns error when Firestore fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Update failed') });

      const result = await repo.updateLlmPreferences('user-123', LlmModels.Gemini25Flash);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Update failed');
      }
    });

    it('creates new settings with fallbackModel when user does not exist', async () => {
      const result = await repo.updateLlmPreferences('new-user-fb', LlmModels.Gemini25Flash, 'or:google/gemma-4-31b-it:free');

      expect(result.ok).toBe(true);

      const stored = await repo.getSettings('new-user-fb');
      expect(stored.ok).toBe(true);
      if (stored.ok && stored.value !== null) {
        expect(stored.value.llmPreferences?.defaultModel).toBe(LlmModels.Gemini25Flash);
        expect(stored.value.llmPreferences?.fallbackModel).toBe('or:google/gemma-4-31b-it:free');
      }
    });

    it('does not set fallbackModel when creating new settings without it', async () => {
      const result = await repo.updateLlmPreferences('new-user-nofb', LlmModels.Gemini25Flash);

      expect(result.ok).toBe(true);

      const stored = await repo.getSettings('new-user-nofb');
      expect(stored.ok).toBe(true);
      if (stored.ok && stored.value !== null) {
        expect(stored.value.llmPreferences?.fallbackModel).toBeUndefined();
      }
    });

    it('updates fallbackModel on existing document', async () => {
      await repo.saveSettings(createTestSettings());

      const result = await repo.updateLlmPreferences('user-123', LlmModels.Gemini25Flash, 'or:google/gemma-4-31b-it:free');

      expect(result.ok).toBe(true);

      const stored = await repo.getSettings('user-123');
      expect(stored.ok).toBe(true);
      if (stored.ok && stored.value !== null) {
        expect(stored.value.llmPreferences?.fallbackModel).toBe('or:google/gemma-4-31b-it:free');
      }
    });

    it('clears fallbackModel when null is passed on existing document', async () => {
      await repo.saveSettings(createTestSettings({
        llmPreferences: { defaultModel: LlmModels.Gemini25Flash, fallbackModel: 'or:google/gemma-4-31b-it:free' },
      }));

      const result = await repo.updateLlmPreferences('user-123', LlmModels.Gemini25Flash, null);

      expect(result.ok).toBe(true);

      const stored = await repo.getSettings('user-123');
      expect(stored.ok).toBe(true);
      if (stored.ok && stored.value !== null) {
        expect(stored.value.llmPreferences?.fallbackModel).toBeUndefined();
      }
    });

    it('leaves fallbackModel unchanged when undefined is passed on existing document', async () => {
      await repo.saveSettings(createTestSettings({
        llmPreferences: { defaultModel: LlmModels.GPT4oMini, fallbackModel: 'or:google/gemma-4-31b-it:free' },
      }));

      const result = await repo.updateLlmPreferences('user-123', LlmModels.Gemini25Flash, undefined);

      expect(result.ok).toBe(true);

      const stored = await repo.getSettings('user-123');
      expect(stored.ok).toBe(true);
      if (stored.ok && stored.value !== null) {
        expect(stored.value.llmPreferences?.defaultModel).toBe(LlmModels.Gemini25Flash);
        expect(stored.value.llmPreferences?.fallbackModel).toBe('or:google/gemma-4-31b-it:free');
      }
    });
  });

  describe('getSettings with llmPreferences', () => {
    it('returns llmPreferences when present', async () => {
      const settings = createTestSettings({
        llmPreferences: { defaultModel: LlmModels.GPT4oMini },
      });
      await repo.saveSettings(settings);

      const result = await repo.getSettings('user-123');

      expect(result.ok).toBe(true);
      if (result.ok && result.value !== null) {
        expect(result.value.llmPreferences?.defaultModel).toBe(LlmModels.GPT4oMini);
      }
    });
  });

  describe('updateTranscriptionPreferences', () => {
    it('creates new settings document when user does not exist', async () => {
      const result = await repo.updateTranscriptionPreferences('new-user', 'speechmatics');

      expect(result.ok).toBe(true);

      const stored = await repo.getSettings('new-user');
      expect(stored.ok).toBe(true);
      if (stored.ok && stored.value !== null) {
        expect(stored.value.userId).toBe('new-user');
        expect(stored.value.transcriptionPreferences?.provider).toBe('speechmatics');
      }
    });

    it('updates existing settings document', async () => {
      await repo.saveSettings(createTestSettings());

      const result = await repo.updateTranscriptionPreferences('user-123', 'speechmatics');

      expect(result.ok).toBe(true);

      const stored = await repo.getSettings('user-123');
      expect(stored.ok).toBe(true);
      if (stored.ok && stored.value !== null) {
        expect(stored.value.transcriptionPreferences?.provider).toBe('speechmatics');
      }
    });

    it('returns error when Firestore fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Update failed') });

      const result = await repo.updateTranscriptionPreferences('user-123', 'speechmatics');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Update failed');
      }
    });
  });

  describe('getSettings with transcriptionPreferences', () => {
    it('returns transcriptionPreferences when present', async () => {
      const settings = createTestSettings({
        transcriptionPreferences: { provider: 'speechmatics' },
      });
      await repo.saveSettings(settings);

      const result = await repo.getSettings('user-123');

      expect(result.ok).toBe(true);
      if (result.ok && result.value !== null) {
        expect(result.value.transcriptionPreferences?.provider).toBe('speechmatics');
      }
    });
  });

  describe('saveSettings with transcriptionPreferences', () => {
    it('persists transcriptionPreferences and reads back correctly', async () => {
      const settings = createTestSettings({
        transcriptionPreferences: { provider: 'speechmatics' },
      });
      await repo.saveSettings(settings);

      const stored = await repo.getSettings('user-123');
      expect(stored.ok).toBe(true);
      if (stored.ok && stored.value !== null) {
        expect(stored.value.transcriptionPreferences?.provider).toBe('speechmatics');
      }
    });
  });

  describe('updateTimezone', () => {
    it('creates new settings document when user does not exist', async () => {
      const result = await repo.updateTimezone('new-user', 'Europe/Berlin');

      expect(result.ok).toBe(true);

      const stored = await repo.getSettings('new-user');
      expect(stored.ok).toBe(true);
      if (stored.ok && stored.value !== null) {
        expect(stored.value.userId).toBe('new-user');
        expect(stored.value.timezone).toBe('Europe/Berlin');
      }
    });

    it('updates existing settings document', async () => {
      await repo.saveSettings(createTestSettings());

      const result = await repo.updateTimezone('user-123', 'America/New_York');

      expect(result.ok).toBe(true);

      const stored = await repo.getSettings('user-123');
      expect(stored.ok).toBe(true);
      if (stored.ok && stored.value !== null) {
        expect(stored.value.timezone).toBe('America/New_York');
      }
    });

    it('returns error when Firestore fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Update failed') });

      const result = await repo.updateTimezone('user-123', 'Europe/Berlin');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Update failed');
      }
    });
  });

  describe('getSettings with timezone', () => {
    it('returns timezone when present', async () => {
      const settings = createTestSettings({
        timezone: 'Asia/Tokyo',
      });
      await repo.saveSettings(settings);

      const result = await repo.getSettings('user-123');

      expect(result.ok).toBe(true);
      if (result.ok && result.value !== null) {
        expect(result.value.timezone).toBe('Asia/Tokyo');
      }
    });
  });

  describe('narrow selector and timezone reads', () => {
    it('strictly projects selector state and reports malformed stored values as a closed result', async () => {
      fakeFirestore.seedCollection('user_settings', [
        {
          id: 'valid',
          data: {
            userId: 'valid',
            llmPreferences: {
              intexAgentModel: IntexAgentModels.MiniMaxM3,
              intexAgentModelRevision: 3,
            },
            createdAt: 'created',
            updatedAt: 'updated',
          },
        },
        {
          id: 'absent',
          data: { userId: 'absent', createdAt: 'created', updatedAt: 'updated' },
        },
        {
          id: 'invalid',
          data: {
            userId: 'invalid',
            llmPreferences: { intexAgentModelRevision: -1 },
            createdAt: 'created',
            updatedAt: 'updated',
          },
        },
      ]);

      await expect(repo.getIntexAgentModelState('valid')).resolves.toEqual({
        ok: true,
        value: {
          status: 'valid',
          explicitModel: IntexAgentModels.MiniMaxM3,
          revision: 3,
        },
      });
      await expect(repo.getIntexAgentModelState('absent')).resolves.toEqual({
        ok: true,
        value: { status: 'valid', explicitModel: null, revision: 0 },
      });
      await expect(repo.getIntexAgentModelState('missing')).resolves.toEqual({
        ok: true,
        value: { status: 'valid', explicitModel: null, revision: 0 },
      });
      await expect(repo.getIntexAgentModelState('invalid')).resolves.toEqual({
        ok: true,
        value: { status: 'invalid_stored_value' },
      });
    });

    it('reads only timezone and preserves an invalid selector map without decoding it', async () => {
      fakeFirestore.seedCollection('user_settings', [
        {
          id: 'timezone-only',
          data: {
            userId: 'timezone-only',
            timezone: 'Europe/Warsaw',
            llmPreferences: 'corrupt-selector-map',
            createdAt: 'created',
            updatedAt: 'updated',
          },
        },
      ]);

      await expect(repo.getTimezonePreference('timezone-only')).resolves.toEqual({
        ok: true,
        value: 'Europe/Warsaw',
      });
      await expect(repo.getTimezonePreference('missing')).resolves.toEqual({
        ok: true,
        value: undefined,
      });

      fakeFirestore.configure({ errorToThrow: new Error('Timezone read failed') });
      await expect(repo.getTimezonePreference('timezone-only')).resolves.toMatchObject({
        ok: false,
        error: { code: 'INTERNAL_ERROR' },
      });
    });

    it('strictly decodes absent, valid, and corrupt stored timezone values', async () => {
      fakeFirestore.seedCollection('user_settings', [
        {
          id: 'timezone-absent',
          data: { userId: 'timezone-absent', createdAt: 'created', updatedAt: 'updated' },
        },
        {
          id: 'timezone-valid',
          data: {
            userId: 'timezone-valid',
            timezone: 'Europe/Warsaw',
            createdAt: 'created',
            updatedAt: 'updated',
          },
        },
        ...[
          ['number', 42],
          ['undefined', undefined],
          ['null', null],
          ['empty', ''],
          ['invalid-iana', 'Invalid/Timezone'],
        ].map(([suffix, timezone]) => ({
          id: `timezone-${String(suffix)}`,
          data: {
            userId: `timezone-${String(suffix)}`,
            timezone,
            createdAt: 'created',
            updatedAt: 'updated',
          },
        })),
      ]);

      await expect(repo.getTimezonePreference('timezone-absent')).resolves.toEqual({
        ok: true,
        value: undefined,
      });
      await expect(repo.getTimezonePreference('timezone-valid')).resolves.toEqual({
        ok: true,
        value: 'Europe/Warsaw',
      });
      for (const suffix of ['number', 'undefined', 'null', 'empty', 'invalid-iana']) {
        await expect(repo.getTimezonePreference(`timezone-${suffix}`)).resolves.toEqual({
          ok: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Stored timezone preference is invalid',
          },
        });
      }
    });
  });

  describe('saveSettings with timezone', () => {
    it('persists timezone and reads back correctly', async () => {
      const settings = createTestSettings({
        timezone: 'Europe/London',
      });
      await repo.saveSettings(settings);

      const stored = await repo.getSettings('user-123');
      expect(stored.ok).toBe(true);
      if (stored.ok && stored.value !== null) {
        expect(stored.value.timezone).toBe('Europe/London');
      }
    });
  });

  describe('updateIntexAgentModel', () => {
    it('proves fake Firestore blocks the second transaction until the first commits', async () => {
      const lifecycle: string[] = [];
      const proofRef = fakeFirestore.collection('transaction_order').doc('proof');
      let signalFirstEntered = (): void => {
        throw new Error('first-entry signal was not initialized');
      };
      let releaseFirst = (): void => {
        throw new Error('first-release signal was not initialized');
      };
      const firstEntered = new Promise<void>((resolve) => {
        signalFirstEntered = resolve;
      });
      const firstReleased = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });

      const firstTransaction = fakeFirestore.runTransaction(async (transaction) => {
        lifecycle.push('first-entered');
        signalFirstEntered();
        transaction.set(proofRef, { committedBy: 'first' });
        await firstReleased;
        lifecycle.push('first-released');
      });
      await firstEntered;

      let secondHasEntered = false;
      const secondTransaction = fakeFirestore.runTransaction(async (transaction) => {
        expect(
          fakeFirestore.getAllData().get('transaction_order')?.get('proof')
        ).toEqual({ committedBy: 'first' });
        secondHasEntered = true;
        lifecycle.push('second-entered');
        transaction.update(proofRef, { committedBy: 'second' });
      });

      await Promise.resolve();
      await Promise.resolve();
      expect(secondHasEntered).toBe(false);
      expect(lifecycle).toEqual(['first-entered']);
      expect(fakeFirestore.getAllData().get('transaction_order')?.get('proof')).toBeUndefined();

      releaseFirst();
      await expect(firstTransaction).resolves.toBeUndefined();
      await expect(secondTransaction).resolves.toBeUndefined();
      expect(fakeFirestore.getAllData().get('transaction_order')?.get('proof')).toEqual({
        committedBy: 'second',
      });
      expect(lifecycle).toEqual([
        'first-entered',
        'first-released',
        'second-entered',
      ]);
    });

    it('treats absent state as revision zero, then sets, resets, and no-ops without creating an absent reset document', async () => {
      const absentReset = await repo.updateIntexAgentModel('absent-user', null, 0);
      expect(absentReset).toEqual({ ok: true, value: { status: 'unchanged', explicitModel: null, revision: 0 } });
      expect(await repo.getSettings('absent-user')).toEqual({ ok: true, value: null });

      const set = await repo.updateIntexAgentModel('user-123', IntexAgentModels.MiniMaxM3, 0);
      expect(set).toEqual({
        ok: true,
        value: { status: 'updated', explicitModel: IntexAgentModels.MiniMaxM3, revision: 1 },
      });

      const unchanged = await repo.updateIntexAgentModel(
        'user-123',
        IntexAgentModels.MiniMaxM3,
        1
      );
      expect(unchanged).toEqual({
        ok: true,
        value: { status: 'unchanged', explicitModel: IntexAgentModels.MiniMaxM3, revision: 1 },
      });

      const reset = await repo.updateIntexAgentModel('user-123', null, 1);
      expect(reset).toEqual({ ok: true, value: { status: 'updated', explicitModel: null, revision: 2 } });

      const stored = await repo.getSettings('user-123');
      expect(stored).toEqual({ ok: true, value: expect.objectContaining({ llmPreferences: { intexAgentModelRevision: 2 } }) });
    });

    it('rejects stale, exhausted, and corrupt stored state without changing raw data', async () => {
      fakeFirestore.seedCollection('user_settings', [
        {
          id: 'stale',
          data: {
            userId: 'stale',
            llmPreferences: { intexAgentModel: IntexAgentModels.MiniMaxM3, intexAgentModelRevision: 2 },
            createdAt: 'created',
            updatedAt: 'updated',
          },
        },
        {
          id: 'exhausted',
          data: {
            userId: 'exhausted',
            llmPreferences: { intexAgentModelRevision: Number.MAX_SAFE_INTEGER },
            createdAt: 'created',
            updatedAt: 'updated',
          },
        },
        {
          id: 'bad-model',
          data: {
            userId: 'bad-model',
            llmPreferences: { intexAgentModel: 'bad-model', intexAgentModelRevision: 1 },
            createdAt: 'created',
            updatedAt: 'updated',
          },
        },
        {
          id: 'bad-revision',
          data: {
            userId: 'bad-revision',
            llmPreferences: { intexAgentModelRevision: -1 },
            createdAt: 'created',
            updatedAt: 'updated',
          },
        },
        {
          id: 'bad-preferences',
          data: {
            userId: 'bad-preferences',
            llmPreferences: 'not-an-object',
            createdAt: 'created',
            updatedAt: 'updated',
          },
        },
      ]);

      const before = structuredClone(fakeFirestore.getAllData().get('user_settings'));
      expect(await repo.updateIntexAgentModel('stale', null, 1)).toEqual({
        ok: true,
        value: { status: 'conflict', explicitModel: IntexAgentModels.MiniMaxM3, revision: 2 },
      });
      expect(await repo.updateIntexAgentModel('exhausted', IntexAgentModels.MiniMaxM3, Number.MAX_SAFE_INTEGER)).toEqual({
        ok: true,
        value: { status: 'revision_exhausted', explicitModel: null, revision: Number.MAX_SAFE_INTEGER },
      });
      for (const userId of ['bad-model', 'bad-revision', 'bad-preferences']) {
        expect(await repo.updateIntexAgentModel(userId, IntexAgentModels.MiniMaxM3, 0)).toEqual({
          ok: true,
          value: { status: 'invalid_stored_value' },
        });
      }
      expect(fakeFirestore.getAllData().get('user_settings')).toEqual(before);
    });

    it('round-trips Intex-only preferences and preserves every sibling on set and reset', async () => {
      const encryptedKey = createEncryptedValue('openrouter');
      fakeFirestore.seedCollection('user_settings', [
        {
          id: 'user-123',
          data: {
            userId: 'user-123',
            llmPreferences: {
              defaultModel: LlmModels.GPT4oMini,
              fallbackModel: 'or:google/gemma-4-31b-it:free',
              futurePreference: { untouched: true },
            },
            llmApiKeys: { openrouter: encryptedKey },
            llmTestResults: { openrouter: { status: 'success', message: 'tested', testedAt: 'then' } },
            timezone: 'Europe/Warsaw',
            transcriptionPreferences: { provider: 'speechmatics' },
            createdAt: 'created',
            updatedAt: 'old-updated',
          },
        },
      ]);

      await repo.updateIntexAgentModel('user-123', IntexAgentModels.Gemini3FlashPreview, 0);
      await repo.updateIntexAgentModel('user-123', null, 1);

      const raw = fakeFirestore.getAllData().get('user_settings')?.get('user-123');
      expect(raw).toMatchObject({
        userId: 'user-123',
        llmPreferences: {
          defaultModel: LlmModels.GPT4oMini,
          fallbackModel: 'or:google/gemma-4-31b-it:free',
          intexAgentModelRevision: 2,
          futurePreference: { untouched: true },
        },
        llmApiKeys: { openrouter: encryptedKey },
        llmTestResults: { openrouter: { status: 'success', message: 'tested', testedAt: 'then' } },
        timezone: 'Europe/Warsaw',
        transcriptionPreferences: { provider: 'speechmatics' },
        createdAt: 'created',
      });
      expect(raw?.['llmPreferences']).not.toHaveProperty('intexAgentModel');
      expect(raw?.['updatedAt']).not.toBe('old-updated');

      await repo.updateIntexAgentModel('intex-only', IntexAgentModels.MiniMaxM3, 0);
      const intexOnly = fakeFirestore.getAllData().get('user_settings')?.get('intex-only');
      expect(Object.keys(intexOnly ?? {}).sort()).toEqual([
        'createdAt',
        'llmPreferences',
        'updatedAt',
        'userId',
      ]);
      expect(intexOnly?.['llmPreferences']).toEqual({
        intexAgentModel: IntexAgentModels.MiniMaxM3,
        intexAgentModelRevision: 1,
      });
      expect(await repo.getSettings('intex-only')).toEqual({
        ok: true,
        value: expect.objectContaining({
          llmPreferences: { intexAgentModel: IntexAgentModels.MiniMaxM3, intexAgentModelRevision: 1 },
        }),
      });
    });

    it('clears only general model paths while preserving Intex and unknown preferences', async () => {
      await repo.saveSettings(
        createTestSettings({
          llmPreferences: {
            defaultModel: LlmModels.GPT4oMini,
            fallbackModel: 'or:google/gemma-4-31b-it:free',
            intexAgentModel: IntexAgentModels.MiniMaxM3,
            intexAgentModelRevision: 4,
            futurePreference: 'preserved',
          } as NonNullable<UserSettings['llmPreferences']>,
        })
      );

      await expect(repo.clearLlmPreferences('user-123')).resolves.toEqual({ ok: true, value: undefined });

      expect(fakeFirestore.getAllData().get('user_settings')?.get('user-123')?.['llmPreferences']).toEqual({
        intexAgentModel: IntexAgentModels.MiniMaxM3,
        intexAgentModelRevision: 4,
        futurePreference: 'preserved',
      });
    });

    it('preserves selector creation with concurrent absent-document sibling writers', async () => {
      const selector = (): ReturnType<typeof repo.updateIntexAgentModel> =>
        repo.updateIntexAgentModel('race-user', IntexAgentModels.MiniMaxM3, 0);
      const preferences = (): ReturnType<typeof repo.updateLlmPreferences> =>
        repo.updateLlmPreferences('race-user', LlmModels.GPT4oMini, 'or:google/gemma-4-31b-it:free');
      const providerKey = (): ReturnType<typeof repo.updateLlmApiKey> =>
        repo.updateLlmApiKey('race-user', LlmProviders.OpenRouter, createEncryptedValue('race-key'));

      await Promise.all([selector(), preferences()]);
      let raw = fakeFirestore.getAllData().get('user_settings')?.get('race-user');
      expect(raw?.['llmPreferences']).toMatchObject({
        intexAgentModel: IntexAgentModels.MiniMaxM3,
        intexAgentModelRevision: 1,
        defaultModel: LlmModels.GPT4oMini,
        fallbackModel: 'or:google/gemma-4-31b-it:free',
      });

      fakeFirestore.clear();
      await Promise.all([preferences(), selector()]);
      raw = fakeFirestore.getAllData().get('user_settings')?.get('race-user');
      expect(raw?.['llmPreferences']).toMatchObject({
        intexAgentModel: IntexAgentModels.MiniMaxM3,
        intexAgentModelRevision: 1,
        defaultModel: LlmModels.GPT4oMini,
        fallbackModel: 'or:google/gemma-4-31b-it:free',
      });

      fakeFirestore.clear();
      await Promise.all([providerKey(), selector()]);
      raw = fakeFirestore.getAllData().get('user_settings')?.get('race-user');
      expect(raw).toMatchObject({
        llmApiKeys: { openrouter: createEncryptedValue('race-key') },
        llmPreferences: { intexAgentModel: IntexAgentModels.MiniMaxM3, intexAgentModelRevision: 1 },
      });

      fakeFirestore.clear();
      await Promise.all([selector(), providerKey()]);
      raw = fakeFirestore.getAllData().get('user_settings')?.get('race-user');
      expect(raw).toMatchObject({
        llmApiKeys: { openrouter: createEncryptedValue('race-key') },
        llmPreferences: { intexAgentModel: IntexAgentModels.MiniMaxM3, intexAgentModelRevision: 1 },
      });
    });

    it('preserves selector creation with every converted writer in both serialized invocation orders', async () => {
      const writers = [
        {
          invoke: (): Promise<unknown> =>
            repo.updateLlmApiKey('writers-user', LlmProviders.OpenRouter, createEncryptedValue('key')),
          assertStored: (stored: Record<string, unknown>): void => {
            expect(stored).toMatchObject({ llmApiKeys: { openrouter: createEncryptedValue('key') } });
          },
        },
        {
          invoke: (): Promise<unknown> =>
            repo.updateLlmTestResult('writers-user', LlmProviders.Google, {
              status: 'success',
              message: 'ok',
              testedAt: 'then',
            }),
          assertStored: (stored: Record<string, unknown>): void => {
            expect(stored).toMatchObject({
              llmTestResults: { google: { status: 'success', message: 'ok', testedAt: 'then' } },
            });
          },
        },
        {
          invoke: (): Promise<unknown> => repo.updateLlmLastUsed('writers-user', LlmProviders.Google),
          assertStored: (stored: Record<string, unknown>): void => {
            expect(stored).toMatchObject({
              llmTestResults: { google: expect.objectContaining({ status: 'success', message: '' }) },
            });
          },
        },
        {
          invoke: (): Promise<unknown> =>
            repo.updateLlmPreferences('writers-user', LlmModels.GPT4oMini, 'or:google/gemma-4-31b-it:free'),
          assertStored: (stored: Record<string, unknown>): void => {
            expect(stored).toMatchObject({
              llmPreferences: {
                defaultModel: LlmModels.GPT4oMini,
                fallbackModel: 'or:google/gemma-4-31b-it:free',
              },
            });
          },
        },
        {
          invoke: (): Promise<unknown> => repo.updateTranscriptionPreferences('writers-user', 'speechmatics'),
          assertStored: (stored: Record<string, unknown>): void => {
            expect(stored).toMatchObject({ transcriptionPreferences: { provider: 'speechmatics' } });
          },
        },
        {
          invoke: (): Promise<unknown> => repo.updateTimezone('writers-user', 'Europe/Warsaw'),
          assertStored: (stored: Record<string, unknown>): void => {
            expect(stored).toMatchObject({ timezone: 'Europe/Warsaw' });
          },
        },
      ] as const;

      for (const writer of writers) {
        for (const selectorFirst of [true, false]) {
          fakeFirestore.clear();
          const selector = (): Promise<unknown> =>
            repo.updateIntexAgentModel('writers-user', IntexAgentModels.MiniMaxM3, 0);
          const first = selectorFirst ? selector() : writer.invoke();
          const second = selectorFirst ? writer.invoke() : selector();

          await Promise.all([first, second]);

          const stored = fakeFirestore.getAllData().get('user_settings')?.get('writers-user');
          expect(stored).toMatchObject({
            llmPreferences: {
              intexAgentModel: IntexAgentModels.MiniMaxM3,
              intexAgentModelRevision: 1,
            },
          });
          writer.assertStored(stored ?? {});
        }
      }

      for (const googleFirst of [true, false]) {
        fakeFirestore.clear();
        const google = (): Promise<unknown> => repo.updateLlmLastUsed('last-used-user', LlmProviders.Google);
        const openAi = (): Promise<unknown> => repo.updateLlmLastUsed('last-used-user', LlmProviders.OpenAI);
        const first = googleFirst ? google() : openAi();
        const second = googleFirst ? openAi() : google();

        await Promise.all([first, second]);

        expect(fakeFirestore.getAllData().get('user_settings')?.get('last-used-user')).toMatchObject({
          llmTestResults: {
            google: expect.objectContaining({ status: 'success', message: '' }),
            openai: expect.objectContaining({ status: 'success', message: '' }),
          },
        });
      }
    });
  });
});

describe('FakeUserSettingsRepository', () => {
  it('fails closed for corrupt persisted selector maps, models, and revisions', async () => {
    const fake = new FakeUserSettingsRepository();
    for (const [userId, llmPreferences] of [
      ['bad-map', 'not-a-map'],
      ['bad-map-object', new Date('2026-07-19T00:00:00.000Z')],
      ['bad-model', { intexAgentModel: 'not-a-model' }],
      ['bad-revision', { intexAgentModelRevision: -1 }],
    ] as const) {
      fake.setSettings({
        userId,
        llmPreferences: llmPreferences as NonNullable<UserSettings['llmPreferences']>,
        createdAt: 'created',
        updatedAt: 'updated',
      });

      await expect(fake.updateIntexAgentModel(userId, IntexAgentModels.MiniMaxM3, 0)).resolves.toEqual({
        ok: true,
        value: { status: 'invalid_stored_value' },
      });
    }
  });

  it('matches selector and narrow-timezone read semantics, including isolated failures', async () => {
    const fake = new FakeUserSettingsRepository();
    fake.setSettings({
      userId: 'invalid',
      llmPreferences: 'corrupt-selector-map' as unknown as NonNullable<
        UserSettings['llmPreferences']
      >,
      timezone: 'Europe/Warsaw',
      createdAt: 'created',
      updatedAt: 'updated',
    });

    await expect(fake.getIntexAgentModelState('invalid')).resolves.toEqual({
      ok: true,
      value: { status: 'invalid_stored_value' },
    });
    await expect(fake.getTimezonePreference('invalid')).resolves.toEqual({
      ok: true,
      value: 'Europe/Warsaw',
    });
    fake.setFailNextGetTimezonePreference(true);
    await expect(fake.getTimezonePreference('invalid')).resolves.toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' },
    });
    await expect(fake.getTimezonePreference('invalid')).resolves.toEqual({
      ok: true,
      value: 'Europe/Warsaw',
    });

    await expect(fake.getTimezonePreference('missing')).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    for (const timezone of [42, undefined, null, '', 'Invalid/Timezone']) {
      fake.setRawTimezonePreference('invalid-timezone', timezone);
      await expect(fake.getTimezonePreference('invalid-timezone')).resolves.toEqual({
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Stored timezone preference is invalid',
        },
      });
    }
  });
});
