/**
 * User-service domain layer - Settings module.
 *
 * Provides:
 * - models/    Domain entities (UserSettings, SettingsError)
 * - ports/     Interfaces for external dependencies (UserSettingsRepository)
 * - usecases/  Business logic (getUserSettings, updateUserSettings)
 */

// Models
export type {
  UserSettings,
  LlmProvider,
  LlmApiKeys,
  LlmTestResult,
  LlmTestResults,
  SearchMode,
  ResearchSettings,
  NotificationFilter,
  NotificationSettings,
} from './models/UserSettings.js';
export { createDefaultSettings } from './models/UserSettings.js';
export type { SettingsError, SettingsErrorCode } from './models/SettingsError.js';

// Ports
export type { UserSettingsRepository } from './ports/UserSettingsRepository.js';
export type { LlmValidator, LlmValidationError, LlmTestResponse } from './ports/LlmValidator.js';

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

// Utils
export { maskApiKey } from './utils/maskApiKey.js';
