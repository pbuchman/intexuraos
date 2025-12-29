/**
 * Port for User settings persistence.
 * Implemented by infra layer (Firestore).
 */

import type { Result } from '@intexuraos/common-core';
import type { UserSettings } from '../models/UserSettings.js';
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
}
