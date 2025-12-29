# Task 2-1: Add llmApiKeys to UserSettings Model

## Objective

Extend existing UserSettings model to include encrypted LLM API keys.

## File to Modify

`apps/user-service/src/domain/settings/models/UserSettings.ts`

## Current Model

```typescript
export interface UserSettings {
  userId: string;
  notifications: NotificationSettings;
  createdAt: string;
  updatedAt: string;
}
```

## Updated Model

```typescript
import { EncryptedValue } from '@intexuraos/common-core';

/**
 * Encrypted LLM API keys for third-party providers.
 * Keys are encrypted using AES-256-GCM before storage.
 */
export interface LlmApiKeys {
  google?: EncryptedValue;    // Gemini API key
  openai?: EncryptedValue;    // OpenAI API key
  anthropic?: EncryptedValue; // Anthropic API key
}

export interface UserSettings {
  userId: string;
  notifications: NotificationSettings;
  llmApiKeys?: LlmApiKeys;  // NEW
  createdAt: string;
  updatedAt: string;
}
```

## Also Update

- `createDefaultSettings()` function (no change needed, llmApiKeys is optional)
- Export LlmApiKeys type from index.ts

## Verification

```bash
npm run typecheck
npm run lint
```

## Acceptance Criteria

- [ ] LlmApiKeys interface defined
- [ ] UserSettings extended with llmApiKeys
- [ ] LlmApiKeys exported from index.ts
- [ ] `npm run typecheck` passes
