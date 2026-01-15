/**
 * Port for User settings persistence.
 * Implemented by infra layer (Firestore).
 */

import type { Result } from '@intexuraos/common-core';
import type { EncryptedValue } from './Encryptor.js';
import type { LlmProvider, LlmTestResult, UserSettings } from '../models/UserSettings.js';
import type { SettingsError } from '../models/SettingsError.js';

/**
 * Repository for storing and retrieving user settings.
 */
export interface UserSettingsRepository {
  /**
   * Get settings for a user.
   * Returns null if no settings exist (new user).
   */
  getSettings(userId: string): Promise<Result<UserSettings | null, SettingsError>>;

  /**
   * Save settings for a user.
   * Creates or updates the settings document.
   */
  saveSettings(settings: UserSettings): Promise<Result<UserSettings, SettingsError>>;

  /**
   * Update a single LLM API key for a user.
   * Creates the settings document if it doesn't exist.
   */
  updateLlmApiKey(
    userId: string,
    provider: LlmProvider,
    encryptedKey: EncryptedValue
  ): Promise<Result<void, SettingsError>>;

  /**
   * Delete a single LLM API key for a user.
   */
  deleteLlmApiKey(userId: string, provider: LlmProvider): Promise<Result<void, SettingsError>>;

  /**
   * Update the test result for an LLM provider.
   */
  updateLlmTestResult(
    userId: string,
    provider: LlmProvider,
    testResult: LlmTestResult
  ): Promise<Result<void, SettingsError>>;

  /**
   * Update just the testedAt timestamp for an LLM provider.
   * Used when any successful API call is made, preserving the existing response.
   */
  updateLlmLastUsed(userId: string, provider: LlmProvider): Promise<Result<void, SettingsError>>;
}
