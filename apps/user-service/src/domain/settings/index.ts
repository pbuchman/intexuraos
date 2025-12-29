/**
 * User-service domain layer - Settings module.
 *
 * Provides:
 * - models/    Domain entities (UserSettings, NotificationFilter, SettingsError)
 * - ports/     Interfaces for external dependencies (UserSettingsRepository)
 * - usecases/  Business logic (getUserSettings, updateUserSettings)
 */

// Models
export type {
  UserSettings,
  NotificationFilter,
  NotificationSettings,
  LlmProvider,
  LlmApiKeys,
} from './models/UserSettings.js';
export { createDefaultSettings } from './models/UserSettings.js';
export type { SettingsError, SettingsErrorCode } from './models/SettingsError.js';

// Ports
export type { UserSettingsRepository } from './ports/UserSettingsRepository.js';

// Usecases
export {
  type GetUserSettingsInput,
  type GetUserSettingsError,
  type GetUserSettingsErrorCode,
  type GetUserSettingsDeps,
  getUserSettings,
  type UpdateUserSettingsInput,
  type UpdateUserSettingsError,
  type UpdateUserSettingsErrorCode,
  type UpdateUserSettingsDeps,
  updateUserSettings,
} from './usecases/index.js';
