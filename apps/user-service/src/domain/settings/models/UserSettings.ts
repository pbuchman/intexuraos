/**
 * User settings domain models.
 * Represents user preferences and configuration.
 */

import type { LlmProvider, LLMModel } from '@intexuraos/llm-contract';
import type { EncryptedValue } from '../../../infra/encryption.js';

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
<<<<<<< HEAD
  zhipu?: EncryptedValue; // Zhipu GLM API key
=======
  zai?: EncryptedValue; // Zai GLM API key
>>>>>>> origin/development
}

/**
 * Test results for each LLM provider.
 */
export interface LlmTestResults {
  google?: LlmTestResult;
  openai?: LlmTestResult;
  anthropic?: LlmTestResult;
  perplexity?: LlmTestResult;
<<<<<<< HEAD
  zhipu?: LlmTestResult;
=======
  zai?: LlmTestResult;
>>>>>>> origin/development
}

/**
 * LLM preferences for user-selected models.
 */
export interface LlmPreferences {
  defaultModel: LLMModel; // User's preferred default LLM model
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
  createdAt: string;
  updatedAt: string;
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
