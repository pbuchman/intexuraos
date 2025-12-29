/**
 * Update User Settings Use-Case
 *
 * Updates user settings with authorization check.
 * Creates settings if they don't exist.
 */

import { ok, err, isErr, type Result } from '@intexuraos/common-core';
import type { UserSettingsRepository } from '../ports/UserSettingsRepository.js';
import {
  type UserSettings,
  type NotificationSettings,
  createDefaultSettings,
} from '../models/UserSettings.js';

/**
 * Input for the update user settings use-case.
 */
export interface UpdateUserSettingsInput {
  userId: string;
  requestingUserId: string;
  notifications: NotificationSettings;
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
  const { userId, requestingUserId, notifications } = input;
  const { userSettingsRepository } = deps;

  // Authorization check: user can only update their own settings
  if (userId !== requestingUserId) {
    return err({
      code: 'FORBIDDEN',
      message: 'You can only update your own settings',
    });
  }

  // Validate filters
  const filters = notifications.filters;

  // Check for duplicate filter names
  const filterNames = new Set<string>();
  for (const filter of filters) {
    if (filterNames.has(filter.name)) {
      return err({
        code: 'INVALID_REQUEST',
        message: `Duplicate filter name: ${filter.name}`,
      });
    }
    filterNames.add(filter.name);
  }

  // Check that each filter has at least one criterion
  for (const filter of filters) {
    if (filter.app === undefined && filter.source === undefined && filter.title === undefined) {
      return err({
        code: 'INVALID_REQUEST',
        message: `Filter "${filter.name}" must have at least one criterion (app, source, or title)`,
      });
    }
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

  // Update settings
  const updatedSettings: UserSettings = {
    ...existingSettings,
    notifications,
    updatedAt: new Date().toISOString(),
  };

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
