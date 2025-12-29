# 2-2: User Settings Model

**Tier:** 2 - Encryption Infrastructure + User Service Extension
**Status:** Pending

## Context

Extend UserSettings model to include LLM API keys.

## Problem Statement

User-service needs to store encrypted API keys for Google, OpenAI, and Anthropic.

## Scope

**In Scope:**
- Add `llmApiKeys` field to `UserSettings` model
- Update Firestore repository to encrypt/decrypt keys
- Handle optional field (backwards compatible)

**Out of Scope:**
- API routes (2-3)
- Validation (2-4)

## Required Approach

1. Add optional `llmApiKeys` to UserSettings interface
2. Encrypt before Firestore write
3. Decrypt after Firestore read
4. Return `undefined` if encryption key not available

## Step Checklist

- [ ] Update `apps/user-service/src/domain/settings/models/UserSettings.ts`
- [ ] Add `llmApiKeys?: { google?: string; openai?: string; anthropic?: string }`
- [ ] Update `apps/user-service/src/infra/firestore/userSettingsRepository.ts`
- [ ] Import encryption utilities from common-core
- [ ] Encrypt keys on save, decrypt on load
- [ ] Handle missing encryption key gracefully

## Definition of Done

- [ ] Model includes llmApiKeys field
- [ ] Repository encrypts/decrypts correctly
- [ ] Backwards compatible (existing data works)
- [ ] `npm run typecheck` passes

## Verification Commands

```bash
npm run typecheck
npm run test --workspace=@intexuraos/user-service
```

## Rollback Plan

Remove llmApiKeys field and encryption logic.
