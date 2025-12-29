/**
 * User settings domain models.
 * Represents user preferences and configuration.
 */

import type { EncryptedValue } from '@intexuraos/common-core';

/**
 * A notification filter configuration.
 * Requires a unique name and at least one filter criterion.
 */
export interface NotificationFilter {
  name: string; // Unique within user's filters
  app?: string; // e.g., "com.whatsapp"
  source?: string; // e.g., "tasker"
  title?: string; // Partial match, case-insensitive
}

/**
 * Notification-related settings.
 */
export interface NotificationSettings {
  filters: NotificationFilter[];
}

/**
 * LLM provider identifiers.
 */
export type LlmProvider = 'google' | 'openai' | 'anthropic';

/**
 * Encrypted LLM API keys for third-party providers.
 * Keys are encrypted using AES-256-GCM before storage.
 */
export interface LlmApiKeys {
  google?: EncryptedValue; // Gemini API key
  openai?: EncryptedValue; // OpenAI API key
  anthropic?: EncryptedValue; // Anthropic API key
}

/**
 * User settings aggregate.
 */
export interface UserSettings {
  userId: string;
  notifications: NotificationSettings;
  llmApiKeys?: LlmApiKeys;
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
    notifications: { filters: [] },
    createdAt: now,
    updatedAt: now,
  };
}
