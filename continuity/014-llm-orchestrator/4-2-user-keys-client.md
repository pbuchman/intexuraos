# 4-2: User Keys Client

**Tier:** 4 - LLM Orchestrator Infrastructure
**Status:** Pending

## Context

Client to fetch user's LLM API keys.

## Problem Statement

llm-orchestrator-service needs access to user's API keys stored in user-service.

## Scope

**In Scope:**
- Create client to read user settings from Firestore
- Decrypt API keys using encryption utility
- Return keys or null if not set

**Out of Scope:**
- Key management (user-service responsibility)

## Required Approach

Decision made: Direct Firestore access (Option B) for simplicity.

1. Read from `user_settings` collection directly
2. Use encryption utility to decrypt keys
3. Return structured result

## Step Checklist

- [ ] Create `apps/llm-orchestrator-service/src/infra/auth/userApiKeysClient.ts`
- [ ] Import Firestore client and encryption utility
- [ ] Implement `getUserApiKeys(userId: string)` method
- [ ] Decrypt keys before returning
- [ ] Handle missing keys gracefully

## Definition of Done

- [ ] Client retrieves and decrypts keys
- [ ] Returns null for missing keys
- [ ] `npm run typecheck` passes

## Verification Commands

```bash
npm run typecheck --workspace=@intexuraos/llm-orchestrator-service
```

## Rollback Plan

Delete client file.
