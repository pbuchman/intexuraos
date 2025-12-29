# Task 2-1: Add llmApiKeys to UserSettings Model

**Tier:** 2 (Depends on 2-0 encryption utility)

---

## Context Snapshot

- UserSettings model exists in `apps/user-service/src/domain/settings/models/UserSettings.ts`
- Need to extend with `llmApiKeys` field for storing encrypted LLM API keys
- Uses `EncryptedValue` type from common-core (added in 2-0)

**Working according to:** `.github/prompts/continuity.prompt.md`

---

## Problem Statement

UserSettings model needs a new `llmApiKeys` field to store encrypted API keys for Google (Gemini), OpenAI (GPT), and Anthropic (Claude).

---

## Scope

**In scope:**

- Define `LlmApiKeys` interface
- Add `llmApiKeys?: LlmApiKeys` to `UserSettings` interface
- Export `LlmApiKeys` type
- Update any serialization logic if needed

**Non-scope:**

- Routes for setting/getting keys (task 2-2)
- Actual encryption logic (task 2-0)

---

## Required Approach

### Step 1: Check current UserSettings model

Read `apps/user-service/src/domain/settings/models/UserSettings.ts` to understand current structure.

### Step 2: Add LlmApiKeys interface

```typescript
import type { EncryptedValue } from '@intexuraos/common-core';

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
```

### Step 3: Extend UserSettings

```typescript
export interface UserSettings {
  userId: string;
  notifications: NotificationSettings;
  llmApiKeys?: LlmApiKeys; // NEW FIELD
  createdAt: string;
  updatedAt: string;
}
```

### Step 4: Update exports

Ensure `LlmApiKeys` and `LlmProvider` are exported from the module's index.

### Step 5: Check Firestore serialization

Verify that the Firestore repository correctly handles the new optional field:

- Existing documents without `llmApiKeys` should work
- `llmApiKeys` should be stored/retrieved as nested object

---

## Step Checklist

- [ ] Read current UserSettings.ts file
- [ ] Add import for `EncryptedValue` from common-core
- [ ] Define `LlmProvider` type
- [ ] Define `LlmApiKeys` interface
- [ ] Add `llmApiKeys?: LlmApiKeys` to `UserSettings`
- [ ] Export new types from domain/settings/index.ts
- [ ] Verify Firestore repository handles the field
- [ ] Run verification commands

---

## Definition of Done

1. `LlmApiKeys` interface defined with encrypted value fields
2. `UserSettings` interface extended with optional `llmApiKeys`
3. Types exported from domain/settings
4. Existing tests still pass
5. `npm run typecheck` passes

---

## Verification Commands

```bash
npm run typecheck
npm run test -- apps/user-service
npm run lint
```

---

## Rollback Plan

If verification fails:

1. Revert changes to `UserSettings.ts`
2. Revert changes to domain/settings/index.ts
3. Remove EncryptedValue import
