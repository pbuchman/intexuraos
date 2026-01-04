/**
 * User settings domain models.
 * Represents user preferences and configuration.
 */

import type { EncryptedValue } from '@intexuraos/common-core';
import type { SupportedModel } from '@intexuraos/llm-contract';

/**
 * LLM provider identifiers.
 */
export type LlmProvider = 'google' | 'openai' | 'anthropic' | 'perplexity';

/**
 * Result of testing an LLM API key.
 */
export interface LlmTestResult {
  response: string;
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
}

/**
 * Test results for each LLM provider.
 */
export interface LlmTestResults {
  google?: LlmTestResult;
  openai?: LlmTestResult;
  anthropic?: LlmTestResult;
  perplexity?: LlmTestResult;
}

/**
 * Research-related settings.
 * If defaultModels is undefined, system defaults will be used.
 */
export interface ResearchSettings {
  defaultModels?: SupportedModel[];
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
  researchSettings?: ResearchSettings;
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
