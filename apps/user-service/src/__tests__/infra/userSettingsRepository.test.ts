/**
 * Tests for Firestore UserSettings repository.
 * Uses FakeFirestore for in-memory testing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import type { EncryptedValue } from '@intexuraos/common-core';
import { FirestoreUserSettingsRepository } from '../../infra/firestore/index.js';
import type { LlmTestResult, UserSettings } from '../../domain/settings/index.js';

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
        testedAt: new Date().toISOString(),
        response: 'Hello!',
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
        expect(result.value.llmTestResults?.google?.response).toBe('Hello!');
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
        response: 'Hello from GPT!',
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
        expect(result.value.llmTestResults?.openai?.response).toBe('Hello from GPT!');
      }
    });
  });

  describe('updateLlmApiKey', () => {
    it('creates new settings document if user does not exist', async () => {
      const encryptedKey = createEncryptedValue('google-key');

      const result = await repo.updateLlmApiKey('new-user', 'google', encryptedKey);

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
      const result = await repo.updateLlmApiKey('user-123', 'anthropic', encryptedKey);

      expect(result.ok).toBe(true);

      const stored = await repo.getSettings('user-123');
      expect(stored.ok).toBe(true);
      if (stored.ok && stored.value !== null) {
        expect(stored.value.llmApiKeys?.anthropic).toBeDefined();
      }
    });

    it('returns error when Firestore fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Update failed') });

      const result = await repo.updateLlmApiKey('user-123', 'google', createEncryptedValue('key'));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Update failed');
      }
    });
  });

  describe('deleteLlmApiKey', () => {
    it('deletes existing API key', async () => {
      await repo.updateLlmApiKey('user-123', 'google', createEncryptedValue('google-key'));
      await repo.updateLlmApiKey('user-123', 'openai', createEncryptedValue('openai-key'));

      const result = await repo.deleteLlmApiKey('user-123', 'google');

      expect(result.ok).toBe(true);

      const stored = await repo.getSettings('user-123');
      expect(stored.ok).toBe(true);
      if (stored.ok && stored.value !== null) {
        expect(stored.value.llmApiKeys?.google).toBeUndefined();
        expect(stored.value.llmApiKeys?.openai).toBeDefined();
      }
    });

    it('deletes associated test result when deleting key', async () => {
      await repo.updateLlmApiKey('user-123', 'google', createEncryptedValue('key'));
      await repo.updateLlmTestResult('user-123', 'google', {
        response: 'Test passed',
        testedAt: new Date().toISOString(),
      });

      const result = await repo.deleteLlmApiKey('user-123', 'google');

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

      const result = await repo.deleteLlmApiKey('user-123', 'google');

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
        response: 'Test response',
      };

      const result = await repo.updateLlmTestResult('new-user', 'google', testResult);

      expect(result.ok).toBe(true);

      const stored = await repo.getSettings('new-user');
      expect(stored.ok).toBe(true);
      if (stored.ok && stored.value !== null) {
        expect(stored.value.userId).toBe('new-user');
        expect(stored.value.llmTestResults?.google?.response).toBe('Test response');
      }
    });

    it('updates existing settings document', async () => {
      await repo.saveSettings(createTestSettings());

      const testResult: LlmTestResult = {
        testedAt: new Date().toISOString(),
        response: 'OpenAI response',
      };

      const result = await repo.updateLlmTestResult('user-123', 'openai', testResult);

      expect(result.ok).toBe(true);

      const stored = await repo.getSettings('user-123');
      expect(stored.ok).toBe(true);
      if (stored.ok && stored.value !== null) {
        expect(stored.value.llmTestResults?.openai?.response).toBe('OpenAI response');
      }
    });

    it('returns error when Firestore fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Update failed') });

      const result = await repo.updateLlmTestResult('user-123', 'google', {
        response: 'Test response',
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
      const result = await repo.updateLlmLastUsed('new-user', 'google');

      expect(result.ok).toBe(true);

      const stored = await repo.getSettings('new-user');
      expect(stored.ok).toBe(true);
      if (stored.ok && stored.value !== null) {
        expect(stored.value.userId).toBe('new-user');
        expect(stored.value.llmTestResults?.google?.testedAt).toBeDefined();
        expect(stored.value.llmTestResults?.google?.response).toBe('');
      }
    });

    it('updates testedAt for existing settings document', async () => {
      await repo.saveSettings(createTestSettings());

      const result = await repo.updateLlmLastUsed('user-123', 'openai');

      expect(result.ok).toBe(true);

      const stored = await repo.getSettings('user-123');
      expect(stored.ok).toBe(true);
      if (stored.ok && stored.value !== null) {
        expect(stored.value.llmTestResults?.openai?.testedAt).toBeDefined();
      }
    });

    it('returns error when Firestore fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Update failed') });

      const result = await repo.updateLlmLastUsed('user-123', 'google');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Update failed');
      }
    });
  });
});
