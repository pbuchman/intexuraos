/**
 * Update User Settings Use-Case
 *
 * Updates user settings with authorization check.
 * Creates settings if they don't exist.
 */

import { err, isErr, ok, type Result } from '@intexuraos/common-core';
import type { UserSettingsRepository } from '../ports/UserSettingsRepository.js';
import {
  createDefaultSettings,
  type NotificationSettings,
  type ResearchSettings,
  type UserSettings,
} from '../models/UserSettings.js';

/**
 * Input for the update user settings use-case.
 */
export interface UpdateUserSettingsInput {
  userId: string;
  requestingUserId: string;
  notifications?: NotificationSettings;
  researchSettings?: ResearchSettings;
}

/**
 * Error codes for update settings failures.
 */
export type UpdateUserSettingsErrorCode = 'FORBIDDEN' | 'INVALID_REQUEST' | 'INTERNAL_ERROR';

/**
 * Update settings error.
 */
export interface UpdateUserSettingsError {
  code: UpdateUserSettingsErrorCode;
  message: string;
}

/**
 * Dependencies for the use-case.
 */
export interface UpdateUserSettingsDeps {
  userSettingsRepository: UserSettingsRepository;
}

/**
 * Execute the update user settings use-case.
 *
 * @param input - User ID, requesting user ID, and new settings
 * @param deps - Repository dependency
 * @returns Result with updated settings or error
 */
export async function updateUserSettings(
  input: UpdateUserSettingsInput,
  deps: UpdateUserSettingsDeps
): Promise<Result<UserSettings, UpdateUserSettingsError>> {
  const { userId, requestingUserId, notifications, researchSettings } = input;
  const { userSettingsRepository } = deps;

  // Authorization check: user can only update their own settings
  if (userId !== requestingUserId) {
    return err({
      code: 'FORBIDDEN',
      message: 'You can only update your own settings',
    });
  }

  // Get existing settings or create defaults
  const getResult = await userSettingsRepository.getSettings(userId);
  if (isErr(getResult)) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to retrieve settings: ${getResult.error.message}`,
    });
  }

  // Type narrowing: after isErr check, we know it's ok
  const fetchedSettings = (getResult as { ok: true; value: UserSettings | null }).value;
  const existingSettings = fetchedSettings ?? createDefaultSettings(userId);

  // Update settings (only update fields that were provided)
  const updatedSettings: UserSettings = {
    ...existingSettings,
    updatedAt: new Date().toISOString(),
  };
  if (notifications !== undefined) {
    updatedSettings.notifications = notifications;
  }
  if (researchSettings !== undefined) {
    updatedSettings.researchSettings = researchSettings;
  }

  // Save updated settings
  const saveResult = await userSettingsRepository.saveSettings(updatedSettings);
  if (isErr(saveResult)) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to save settings: ${saveResult.error.message}`,
    });
  }

  // Type narrowing: after isErr check, we know it's ok
  const savedSettings = (saveResult as { ok: true; value: UserSettings }).value;
  return ok(savedSettings);
}
