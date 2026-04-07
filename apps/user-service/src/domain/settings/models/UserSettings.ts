/**
 * User settings domain models.
 * Represents user preferences and configuration.
 */

import type { LlmProvider, LLMModel } from '@intexuraos/llm-contract';
import type { EncryptedValue } from '../ports/Encryptor.js';

/**
 * LLM provider identifiers.
 */
export type { LlmProvider };

/**
 * LLM model identifiers.
 */
export type { LLMModel };

/**
 * Result of testing an LLM API key.
 */
export interface LlmTestResult {
  status: 'success' | 'failure';
  message: string; // LLM response (success) or user-friendly error (failure)
  testedAt: string; // ISO timestamp
}

/**
 * Encrypted LLM API keys for third-party providers.
 * Keys are encrypted using AES-256-GCM before storage.
 */
export interface LlmApiKeys {
  google?: EncryptedValue; // Gemini API key
  openai?: EncryptedValue; // OpenAI API key
  anthropic?: EncryptedValue; // Anthropic API key
  perplexity?: EncryptedValue; // Perplexity API key
  openrouter?: EncryptedValue; // OpenRouter API key
}

/**
 * Test results for each LLM provider.
 */
export interface LlmTestResults {
  google?: LlmTestResult;
  openai?: LlmTestResult;
  anthropic?: LlmTestResult;
  perplexity?: LlmTestResult;
  openrouter?: LlmTestResult;
}

/**
 * LLM preferences for user-selected models.
 */
export interface LlmPreferences {
  defaultModel: LLMModel; // User's preferred default LLM model
}

/**
 * Transcription provider identifiers.
 */
export type TranscriptionProvider = 'speechmatics';

/**
 * Valid transcription providers for runtime validation.
 */
export const VALID_TRANSCRIPTION_PROVIDERS: readonly TranscriptionProvider[] = ['speechmatics'];

/**
 * Type guard to check if a value is a valid TranscriptionProvider.
 */
export function isTranscriptionProvider(value: string): value is TranscriptionProvider {
  return (VALID_TRANSCRIPTION_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Transcription preferences for user-selected provider.
 */
export interface TranscriptionPreferences {
  provider: TranscriptionProvider;
}

/**
 * A notification filter rule.
 */
export interface NotificationFilter {
  name: string;
  app?: string;
  source?: string;
  title?: string;
}

/**
 * Notification-related settings.
 */
export interface NotificationSettings {
  filters: NotificationFilter[];
}

/**
 * User settings aggregate.
 */
export interface UserSettings {
  userId: string;
  notifications?: NotificationSettings;
  llmApiKeys?: LlmApiKeys;
  llmTestResults?: LlmTestResults;
  llmPreferences?: LlmPreferences; // User's LLM model preferences
  transcriptionPreferences?: TranscriptionPreferences; // User's transcription provider preferences
  timezone?: string; // IANA timezone (e.g., "Europe/Berlin")
  createdAt: string;
  updatedAt: string;
}

/**
 * Set of valid IANA timezone strings, built from the runtime.
 */
const VALID_TIMEZONES: ReadonlySet<string> = new Set(Intl.supportedValuesOf('timeZone'));

/**
 * Type guard to check if a value is a valid IANA timezone string.
 */
export function isValidTimezone(value: string): boolean {
  return VALID_TIMEZONES.has(value);
}

/**
 * Creates default empty settings for a new user.
 */
export function createDefaultSettings(userId: string): UserSettings {
  const now = new Date().toISOString();
  return {
    userId,
    createdAt: now,
    updatedAt: now,
  };
}
