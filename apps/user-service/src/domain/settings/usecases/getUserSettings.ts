/**
 * Get User Settings Use-Case
 *
 * Retrieves user settings with authorization check.
 * Returns default settings if none exist.
 */

import { ok, err, isErr, type Result } from '@intexuraos/common-core';
import type { UserSettingsRepository } from '../ports/UserSettingsRepository.js';
import { type UserSettings, createDefaultSettings } from '../models/UserSettings.js';

/**
 * Input for the get user settings use-case.
 */
export interface GetUserSettingsInput {
  userId: string;
  requestingUserId: string;
}

/**
 * Error codes for get settings failures.
 */
export type GetUserSettingsErrorCode = 'FORBIDDEN' | 'INTERNAL_ERROR';

/**
 * Get settings error.
 */
export interface GetUserSettingsError {
  code: GetUserSettingsErrorCode;
  message: string;
}

/**
 * Dependencies for the use-case.
 */
export interface GetUserSettingsDeps {
  userSettingsRepository: UserSettingsRepository;
}

/**
 * Execute the get user settings use-case.
 *
 * @param input - User ID and requesting user ID
 * @param deps - Repository dependency
 * @returns Result with settings or error
 */
export async function getUserSettings(
  input: GetUserSettingsInput,
  deps: GetUserSettingsDeps
): Promise<Result<UserSettings, GetUserSettingsError>> {
  const { userId, requestingUserId } = input;
  const { userSettingsRepository } = deps;

  // Authorization check: user can only access their own settings
  if (userId !== requestingUserId) {
    return err({
      code: 'FORBIDDEN',
      message: 'You can only access your own settings',
    });
  }

  // Get settings from repository
  const result = await userSettingsRepository.getSettings(userId);
  if (isErr(result)) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to retrieve settings: ${result.error.message}`,
    });
  }

  // Type narrowing: after isErr check, we know it's ok
  const existingSettings = (result as { ok: true; value: UserSettings | null }).value;

  // Return existing settings or create defaults
  const settings = existingSettings ?? createDefaultSettings(userId);
  return ok(settings);
}
